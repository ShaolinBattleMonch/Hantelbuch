-- =====================================================================
-- BUILT · Skript 10: Korrektur der Übernahme (vor der ersten Anmeldung ausführen)
-- Supabase blockiert DELETE ohne WHERE, wenn es aus der App kommt.
-- Die Übernahme-Funktion löschte die alte Bibliothek ohne Bedingung und brach deshalb ab.
-- =====================================================================
create or replace function public.claim_legacy(legacy text, code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); cl public.legacy_claims; other uuid; c uuid;
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  select * into cl from public.legacy_claims x where x.legacy_name = legacy for update;
  if not found or cl.claimed_by is not null
     or cl.code_hash <> encode(extensions.digest(upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex') then
    raise exception 'Code passt nicht';
  end if;
  if exists (select 1 from public.profiles p where p.id = me and p.legacy_name is not null) then raise exception 'Schon übernommen'; end if;

  perform set_config('built.claiming', 'on', true);
  update public.profiles p set legacy_name = legacy, name = coalesce(p.name, legacy) where p.id = me;
  update public.legacy_claims x set claimed_by = me, claimed_at = now() where x.legacy_name = legacy;

  insert into public.events (id, user_id, ts, type, summary, data, plan_scope)
    select e.id, me, e.ts, e.type, e.summary, e.data, 'crew' from public.legacy_events e where e.person = legacy order by e.ts
    on conflict (id) do nothing;
  delete from public.legacy_events e where e.person = legacy;

  insert into public.vault (user_id, id, created, body)
    select me, v.id, v.created, v.body from public.legacy_vault v where v.person = legacy
    on conflict do nothing;
  delete from public.legacy_vault v where v.person = legacy;

  -- Bibliothek: einmalig als Grundstock übernehmen
  insert into public.library (id, owner, data) select l.id, null, l.data from public.legacy_library l on conflict (id) do nothing;
  delete from public.legacy_library where true;   -- Supabase verlangt bei DELETE immer ein WHERE

  -- beide übernommen: Freundschaft und gemeinsame Crew
  select x.claimed_by into other from public.legacy_claims x where x.legacy_name <> legacy and x.claimed_by is not null limit 1;
  if other is not null then
    insert into public.friendships (a, b, requested_by, status, accepted_at)
      values (least(me, other), greatest(me, other), other, 'accepted', now())
      on conflict (a, b) do update set status = 'accepted', accepted_at = now();
    select m.crew_id into c from public.crew_members m where m.user_id = other;
    if c is null then
      insert into public.crews (name, owner) values ('Crew', other) returning id into c;
      insert into public.crew_members (crew_id, user_id, role) values (c, other, 'owner');
    end if;
    if not exists (select 1 from public.crew_members m where m.user_id = me) then
      insert into public.crew_members (crew_id, user_id) values (c, me);
    end if;
    update public.events e set crew_id = c where e.user_id in (me, other) and e.plan_scope = 'crew' and e.crew_id is null;
  end if;
  return 'ok';
end $$;

select 'Skript 10 fertig' as status;
