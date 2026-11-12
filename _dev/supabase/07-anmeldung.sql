-- =====================================================================
-- BUILT · Skript 07: Übernahme in der Anmeldung (nach Skript 06 ausführen)
-- =====================================================================

-- Gibt es noch ein altes Profil, das nicht übernommen ist? Nur dann zeigt die App Schritt 3a.
create or replace function public.legacy_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.legacy_claims c where c.claimed_by is null)
$$;

-- Übernahme nur mit dem Code: die Datenbank sucht das passende alte Profil selbst.
-- Höchstens 10 Versuche pro Stunde und Konto.
create table if not exists public.claim_attempts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ts      timestamptz not null default now()
);
alter table public.claim_attempts enable row level security;
grant all on public.claim_attempts to service_role;

create or replace function public.claim_by_code(code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); h text; nm text; res text;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  if (select count(*) from public.claim_attempts a where a.user_id = me and a.ts > now() - interval '1 hour') >= 10 then
    raise exception 'Zu viele Versuche. Bitte in einer Stunde noch einmal.';
  end if;
  insert into public.claim_attempts (user_id) values (me);
  h := encode(extensions.digest(upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
  select c.legacy_name into nm from public.legacy_claims c where c.code_hash = h and c.claimed_by is null;
  if nm is null then raise exception 'Code passt nicht'; end if;
  res := public.claim_legacy(nm, code);
  return jsonb_build_object(
    'name', nm,
    'workouts', (select count(*) from public.events e where e.user_id = me and e.type = 'workout'),
    'vault', (select count(*) from public.vault v where v.user_id = me and v.id not like 'g-%'),
    'gallery', (select count(*) from public.vault v where v.user_id = me and v.id like 'g-%'),
    'chats', (select count(*) from public.legacy_messages m where m.sender = nm or m.recipient = nm),
    'crew', exists (select 1 from public.crew_members m where m.user_id = me)
  );
end $$;

-- Wochenziel: Während der Anmeldung (noch keine Datenschutz-Einwilligung) gilt es sofort,
-- auch bei übernommenen Konten mit alten Trainings. Danach erst ab dem nächsten Montag.
create or replace function public.set_week_goal(n int)
returns date language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); start_next date;
begin
  if n is null or n < 1 or n > 6 then raise exception 'Wochenziel: 1 bis 6'; end if;
  if not exists (select 1 from public.consents c where c.user_id = me and c.kind = 'privacy')
     or not exists (select 1 from public.events e where e.user_id = me and e.type = 'workout') then
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

grant execute on function public.legacy_open(), public.claim_by_code(text) to authenticated;

select 'Skript 07 fertig' as status;
