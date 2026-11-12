-- =====================================================================
-- BUILT · Skript 08: Datenschutz-Funktionen (nach Skript 07 ausführen)
-- =====================================================================

-- Einwilligung „Gesundheitsdaten“ widerrufen und alles löschen:
-- Körpergewicht-Einträge und Vault-Bilder (nicht Galerie „g-“ und Chat-Schlüssel „k-“).
create or replace function public.delete_health_data()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Nicht angemeldet'; end if;
  delete from public.events e where e.user_id = me and e.type = 'bodyweight';
  delete from public.vault v where v.user_id = me and v.id not like 'g-%' and v.id not like 'k-%';
  insert into public.consents (user_id, kind, version, granted) values (me, 'health', '3.0', false);
end $$;
grant execute on function public.delete_health_data() to authenticated;

-- Eigene Übungen: Namensprüfung liest beide Schreibweisen (Import nutzt „Name“, die App zusätzlich „name“)
create or replace function public.library_guard()
returns trigger language plpgsql set search_path = '' as $$
declare nm text := lower(trim(coalesce(new.data->>'name', new.data->>'Name', '')));
begin
  if new.owner is null then return new; end if;
  if nm = '' then raise exception 'Bitte gib der Übung einen Namen.'; end if;
  if not public.is_clean(coalesce(new.data->>'name', new.data->>'Name')) then raise exception 'Bitte wähle einen anderen Namen.'; end if;
  if exists (select 1 from public.library l where l.owner is null and l.id <> new.id
             and lower(trim(coalesce(l.data->>'name', l.data->>'Name', ''))) = nm) then
    raise exception 'Diese Übung gibt es schon in der Bibliothek.';
  end if;
  new.updated_at := now();
  return new;
end $$;

select 'Skript 08 fertig' as status;
