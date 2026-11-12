-- BUILT · Übernahme-Codes für eure alten Profile festlegen
-- Trage unten zwischen die Anführungszeichen je einen eigenen Code ein
-- (mindestens 8 Zeichen, nur Buchstaben und Zahlen). Gespeichert wird nur eine Prüfsumme.
-- Gib Rob seinen Code persönlich, nicht im Gruppenchat. Danach diese Abfrage nicht speichern.
insert into public.legacy_claims (legacy_name, code_hash)
select n, encode(extensions.digest(upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
from (values
  ('Manu', 'HIER-DEIN-CODE'),
  ('Rob',  'HIER-ROBS-CODE')
) as v(n, c)
where char_length(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) >= 8 and c not like 'HIER-%'
on conflict (legacy_name) do update set code_hash = excluded.code_hash
  where public.legacy_claims.claimed_by is null;

select legacy_name, claimed_by is not null as uebernommen from public.legacy_claims;
