-- =====================================================================
-- BUILT · Datenbank-Anpassung für Update 3.0 (Skript 06)
-- Einmal komplett im SQL-Editor ausführen. Darf auch zweimal laufen.
-- Ändert keine vorhandenen Daten, ergänzt nur Spalten, Tabellen, Regeln.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Wochenziel im Profil
--    week_goal       gilt diese Woche
--    week_goal_next  neues Ziel, gilt ab week_goal_from (Montag)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists week_goal smallint not null default 3;
alter table public.profiles add column if not exists week_goal_next smallint;
alter table public.profiles add column if not exists week_goal_from date;
do $$ begin
  alter table public.profiles add constraint profiles_week_goal_check check (week_goal between 1 and 6);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_week_goal_next_check check (week_goal_next is null or week_goal_next between 1 and 6);
exception when duplicate_object then null; end $$;

-- Ziel setzen: Wer noch nie trainiert hat (Anmeldung), bekommt es sofort.
-- Sonst gilt es ab dem nächsten Montag (deutsche Zeit).
create or replace function public.set_week_goal(n int)
returns date language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); start_next date;
begin
  if n is null or n < 1 or n > 6 then raise exception 'Wochenziel: 1 bis 6'; end if;
  if not exists (select 1 from public.events e where e.user_id = me and e.type = 'workout') then
    update public.profiles p set week_goal = n, week_goal_next = null, week_goal_from = null where p.id = me;
    return null;
  end if;
  start_next := (date_trunc('week', (now() at time zone 'Europe/Berlin')) + interval '7 days')::date;
  update public.profiles p
     set week_goal_next = case when n = p.week_goal then null else n end,
         week_goal_from = case when n = p.week_goal then null else start_next end
   where p.id = me;
  return start_next;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ereignisse: private Einträge (Mein Plan) und ein Training pro Tag
-- ---------------------------------------------------------------------
alter table public.events add column if not exists private boolean not null default false;

-- Die App schreibt bei jedem neuen Training das lokale Datum in data.date (JJJJ-MM-TT).
-- Alte Trainings ohne Datum sind davon nicht betroffen.
create unique index if not exists events_one_workout_per_day
  on public.events (user_id, (data->>'date'))
  where type = 'workout' and data ? 'date';

drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (
    user_id = auth.uid()
    or (not private
        and (public.is_friend(user_id) or public.is_crewmate(user_id))
        and not public.is_blocked_between(auth.uid(), user_id)
        and (type <> 'bodyweight' or public.shares_weight(user_id)))
  );

-- ---------------------------------------------------------------------
-- 3. Notizen: privat oder für die Crew, getrennt von den Trainings
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  id         text primary key check (char_length(id) <= 80),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  scope      text not null check (scope in ('private', 'crew')),
  crew_id    uuid references public.crews (id) on delete cascade,
  plan       text not null default 'crew' check (plan in ('mine', 'crew')),
  ex_id      text not null check (char_length(ex_id) <= 64),
  day        text check (char_length(day) <= 8),
  workout_id text check (char_length(workout_id) <= 64),
  ts         timestamptz not null default now(),
  body       text not null check (char_length(body) between 1 and 2000),
  edited_at  timestamptz,
  check ((scope = 'crew') = (crew_id is not null))
);
create index if not exists notes_user_idx on public.notes (user_id, ts desc);
create index if not exists notes_crew_idx on public.notes (crew_id, ex_id, ts desc);

-- Sperrliste auch für Notizen
create or replace function public.notes_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_clean(new.body) then raise exception 'Bitte formuliere die Notiz anders.'; end if;
  return new;
end $$;
drop trigger if exists notes_guard on public.notes;
create trigger notes_guard before insert or update of body on public.notes
  for each row execute function public.notes_guard();

alter table public.notes enable row level security;
drop policy if exists notes_select on public.notes;
drop policy if exists notes_insert on public.notes;
drop policy if exists notes_update on public.notes;
drop policy if exists notes_delete on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (user_id = auth.uid()
         or (scope = 'crew' and crew_id = public.my_crew() and not public.is_blocked_between(auth.uid(), user_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check (user_id = auth.uid()
              and ((scope = 'private' and crew_id is null) or (scope = 'crew' and crew_id = public.my_crew())));
create policy notes_update on public.notes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_delete on public.notes for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, delete on public.notes to authenticated;
grant update (body, edited_at) on public.notes to authenticated;
grant all on public.notes to service_role;

-- ---------------------------------------------------------------------
-- 4. Bibliothek: Grundbestand fest, eigene Übungen nur vom Ersteller änderbar
-- ---------------------------------------------------------------------
-- Zugriff auf Crew-Übungen, die man genutzt hat, bleibt nach dem Austritt erhalten
create table if not exists public.library_shares (
  lib_id  text not null references public.library (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (lib_id, user_id)
);
alter table public.library_shares enable row level security;
drop policy if exists library_shares_select on public.library_shares;
create policy library_shares_select on public.library_shares for select to authenticated using (user_id = auth.uid());
grant select on public.library_shares to authenticated;
grant all on public.library_shares to service_role;

drop policy if exists library_select on public.library;
drop policy if exists library_insert on public.library;
drop policy if exists library_update on public.library;
create policy library_select on public.library for select to authenticated
  using (owner is null or owner = auth.uid()
         or (crew_id is not null and crew_id = public.my_crew())
         or exists (select 1 from public.library_shares s where s.lib_id = id and s.user_id = auth.uid()));
create policy library_insert on public.library for insert to authenticated
  with check (owner = auth.uid() and (crew_id is null or crew_id = public.my_crew()));
create policy library_update on public.library for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and (crew_id is null or crew_id = public.my_crew()));

-- Eigene Übung darf nicht genauso heißen wie eine Übung im Grundbestand
create or replace function public.library_guard()
returns trigger language plpgsql set search_path = '' as $$
declare nm text := lower(trim(coalesce(new.data->>'name', '')));
begin
  if new.owner is null then return new; end if;
  if nm = '' then raise exception 'Bitte gib der Übung einen Namen.'; end if;
  if not public.is_clean(new.data->>'name') then raise exception 'Bitte wähle einen anderen Namen.'; end if;
  if exists (select 1 from public.library l where l.owner is null and lower(trim(l.data->>'name')) = nm) then
    raise exception 'Diese Übung gibt es schon in der Bibliothek.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists library_guard on public.library;
create trigger library_guard before insert or update on public.library
  for each row execute function public.library_guard();

-- ---------------------------------------------------------------------
-- 5. Crew verlassen, entfernen, blockieren
-- ---------------------------------------------------------------------
-- Gemeinsamer Ablauf, wenn jemand (u) die Crew (c) verlässt:
--  · Crew-Übungen anderer, die u trainiert hat, bleiben für u sichtbar
--  · u bekommt seine Crew-Notizen als private Kopie, die Crew behält das Original
create or replace function public.crew_exit(u uuid, c uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare nxt uuid;
begin
  insert into public.library_shares (lib_id, user_id)
    select l.id, u from public.library l
     where l.crew_id = c and l.owner is distinct from u
       and exists (select 1 from public.events e where e.user_id = u and e.type in ('workout', 'workout_edit')
                   and position('"' || l.id || '"' in e.data::text) > 0)
    on conflict do nothing;
  insert into public.notes (id, user_id, scope, crew_id, plan, ex_id, day, workout_id, ts, body, edited_at)
    select left(n.id, 76) || '-p', n.user_id, 'private', null, 'crew', n.ex_id, n.day, n.workout_id, n.ts, n.body, n.edited_at
      from public.notes n where n.user_id = u and n.scope = 'crew' and n.crew_id = c
    on conflict (id) do nothing;
  delete from public.crew_members m where m.crew_id = c and m.user_id = u;
  select m.user_id into nxt from public.crew_members m where m.crew_id = c order by m.joined_at limit 1;
  if nxt is null then
    delete from public.crews x where x.id = c;
  elsif exists (select 1 from public.crews x where x.id = c and x.owner = u) then
    update public.crews x set owner = nxt where x.id = c;
    update public.crew_members m set role = 'owner' where m.crew_id = c and m.user_id = nxt;
  end if;
end $$;
revoke all on function public.crew_exit(uuid, uuid) from public, anon, authenticated;

create or replace function public.leave_crew()
returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := public.my_crew();
begin
  if c is null then return; end if;
  perform public.crew_exit(auth.uid(), c);
end $$;

-- Crew-Chef entfernt jemanden
create or replace function public.remove_from_crew(other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := public.my_crew();
begin
  if c is null or not exists (select 1 from public.crews x where x.id = c and x.owner = auth.uid()) then
    raise exception 'Nur der Crew-Chef kann jemanden entfernen';
  end if;
  if other = auth.uid() or not exists (select 1 from public.crew_members m where m.crew_id = c and m.user_id = other) then
    raise exception 'Nicht in deiner Crew';
  end if;
  perform public.crew_exit(other, c);
end $$;

-- Blockieren: in derselben Crew verlässt man sie (als Chef wird der andere entfernt)
create or replace function public.block_user(other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c uuid := public.my_crew();
begin
  if other is null or other = me then raise exception 'Ungültig'; end if;
  if c is not null and exists (select 1 from public.crew_members m where m.crew_id = c and m.user_id = other) then
    if exists (select 1 from public.crews x where x.id = c and x.owner = me) then
      perform public.crew_exit(other, c);
    else
      perform public.crew_exit(me, c);
    end if;
  end if;
  insert into public.blocks (blocker, blocked) values (me, other) on conflict do nothing;
  delete from public.friendships f where f.a = least(me, other) and f.b = greatest(me, other);
  delete from public.crew_invites i where (i.user_id = other and i.invited_by = me) or (i.user_id = me and i.invited_by = other);
end $$;

-- Crew-Chat: Nachrichten blockierter Personen nicht mehr sehen
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid()
         or (crew_id is not null and crew_id = public.my_crew() and not public.is_blocked_between(auth.uid(), sender)));

-- ---------------------------------------------------------------------
-- 6. Melden und Feedback
-- ---------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('message', 'spot', 'profile', 'crew', 'note'));
alter table public.feedback drop constraint if exists feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('idee', 'fehler', 'lob', 'uebung'));

-- ---------------------------------------------------------------------
-- 7. Alte Chats aus der Google-Tabelle (einmalig, für die Neu-Verschlüsselung)
-- ---------------------------------------------------------------------
create table if not exists public.legacy_messages (
  id        text primary key,
  sender    text not null,     -- Altname „Manu“ / „Rob“
  recipient text not null,
  ts        timestamptz not null,
  body      text not null      -- mit dem alten Sync-Schlüssel verschlüsselt
);
alter table public.legacy_messages enable row level security;
grant all on public.legacy_messages to service_role;

-- Liefert die alten Nachrichten, die ich gesendet habe, plus die Profil-ID des Empfängers
-- (sofern er schon übernommen ist). Nur ich selbst kann sie neu verschlüsseln.
create or replace function public.my_legacy_messages()
returns table (id text, recipient uuid, recipient_legacy text, ts timestamptz, body text)
language sql stable security definer set search_path = '' as $$
  select m.id, p.id, m.recipient, m.ts, m.body
    from public.legacy_messages m
    join public.profiles me on me.id = auth.uid() and me.legacy_name = m.sender
    left join public.profiles p on p.legacy_name = m.recipient
$$;
create or replace function public.drop_legacy_message(mid text)
returns void language sql security definer set search_path = '' as $$
  delete from public.legacy_messages m
   where m.id = mid and m.sender = (select p.legacy_name from public.profiles p where p.id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 8. Export um Notizen und Wochenziel ergänzen
-- ---------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile',  (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'events',   coalesce((select jsonb_agg(to_jsonb(e) order by e.seq) from public.events e where e.user_id = auth.uid()), '[]'::jsonb),
    'notes',    coalesce((select jsonb_agg(to_jsonb(n) order by n.ts) from public.notes n where n.user_id = auth.uid()), '[]'::jsonb),
    'library',  coalesce((select jsonb_agg(to_jsonb(l)) from public.library l where l.owner = auth.uid()), '[]'::jsonb),
    'friends',  coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where auth.uid() in (f.a, f.b)), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.consents c where c.user_id = auth.uid()), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.ts) from public.messages m where m.sender = auth.uid()), '[]'::jsonb),
    'vault',    coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'created', v.created)) from public.vault v where v.user_id = auth.uid()), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- 9. Nächtliches Aufräumen: neues Wochenziel ab Montag übernehmen
-- ---------------------------------------------------------------------
create or replace function public.daily_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.messages m where m.expires_at < now();
  delete from public.spots s where s.expires_at < now();
  delete from public.usage_events u where u.day < current_date - 90;
  delete from public.error_log e where e.created_at < now() - interval '30 days';
  delete from public.search_log s where s.ts < now() - interval '1 day';
  update public.profiles p set week_goal = p.week_goal_next, week_goal_next = null, week_goal_from = null
   where p.week_goal_next is not null and p.week_goal_from <= (now() at time zone 'Europe/Berlin')::date;
  delete from auth.users u where u.id in (select p.id from public.profiles p where p.deleted_at < now() - interval '30 days');
end $$;
revoke all on function public.daily_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Rechte und Echtzeit
-- ---------------------------------------------------------------------
grant execute on function public.set_week_goal(int), public.remove_from_crew(uuid), public.block_user(uuid),
  public.leave_crew(), public.my_legacy_messages(), public.drop_legacy_message(text), public.export_my_data()
  to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;

select 'Skript 06 fertig' as status;
