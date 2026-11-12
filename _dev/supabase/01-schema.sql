-- =====================================================================
-- BUILT · Datenbank-Schema 3.0 für Supabase
-- Einmal komplett im SQL Editor einfügen und auf „Run“ klicken.
-- Das Skript lässt sich gefahrlos ein zweites Mal ausführen.
--
-- Grundsätze
-- * Jede Tabelle hat Zugriffsregeln (Row Level Security). Ohne passende
--   Regel sieht niemand etwas.
-- * Tabellen sind nicht automatisch freigegeben: Jede Freigabe steht
--   unten ausdrücklich bei „grant“.
-- * Chat, Spots und Vault liegen nur verschlüsselt in der Datenbank.
-- * Funktionen mit „security definer“ setzen einen leeren search_path und
--   nennen jede Tabelle mit Schema, damit sie nicht umgelenkt werden können.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------
-- 1. Prüfungen: Namen, Sperrliste, Buddy-ID
-- ---------------------------------------------------------------------

-- Sperrliste für Namen (Chat und Spots prüft die App vor dem Verschlüsseln,
-- mit derselben Liste aus app_config). Kurze Kürzel (bis 4 Zeichen) gelten
-- nur als ganzes Wort oder als Ziffernfolge, längere Begriffe überall im Text.
create table if not exists public.banned_terms (
  term text primary key check (term = lower(term) and char_length(term) between 2 and 40)
);

insert into public.banned_terms (term) values
  -- NS-Bezug und Codes
  ('hitler'), ('nsdap'), ('nazi'), ('neonazi'), ('heil'), ('siegheil'), ('ss'), ('sa'), ('hh'),
  ('88'), ('18'), ('14'), ('1488'), ('28'), ('444'), ('zyklon'), ('auschwitz'), ('fuehrer'), ('fuhrer'),
  ('reichsbuerger'), ('kkk'), ('whitepower'), ('wpww'),
  -- Terrororganisationen
  ('isis'), ('daesh'), ('alqaida'), ('alkaida'), ('taliban'), ('hamas'), ('hisbollah'), ('hezbollah'), ('pkk'),
  -- Beleidigungen und Herabwürdigungen
  ('hurensohn'), ('wichser'), ('fotze'), ('nutte'), ('schlampe'), ('missgeburt'), ('spast'), ('mongo'),
  ('neger'), ('nigger'), ('nigga'), ('kanake'), ('zigeuner'), ('schwuchtel'), ('kinderficker'),
  ('arschloch'), ('fick'), ('fuck'), ('cunt'), ('bitch'), ('retard'), ('faggot'),
  -- reservierte Namen
  ('built'), ('admin'), ('support'), ('moderator'), ('offiziell'), ('official')
on conflict do nothing;

-- Text vereinheitlichen: klein, typische Ersatzzeichen zurück zu Buchstaben
create or replace function public.norm_text(t text)
returns text language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(t, '')), '01345@$!|äöüß', 'oieasasiiaous')
$$;

create or replace function public.is_clean(t text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  raw text := lower(coalesce(t, ''));
  flat text := regexp_replace(public.norm_text(t), '[^a-z]', '', 'g');
  words text[] := regexp_split_to_array(regexp_replace(public.norm_text(t), '[^a-z0-9 ]', ' ', 'g'), '\s+');
  digits text[] := array(select (regexp_matches(raw, '[0-9]+', 'g'))[1]);
  b record;
begin
  for b in select term from public.banned_terms loop
    if char_length(b.term) <= 4 then
      if b.term = any(words) or b.term = any(digits) or (b.term ~ '^[a-z]+$' and flat = b.term) then return false; end if;
    else
      if position(b.term in flat) > 0 then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- Anzeigename: 2–24 Zeichen, Buchstaben (auch Umlaute und Akzente) und Ziffern,
-- höchstens ein Leerzeichen zwischen zwei Wörtern, nichts aus der Sperrliste.
create or replace function public.valid_name(n text)
returns boolean language sql stable set search_path = '' as $$
  select n is not null
    and char_length(n) between 2 and 24
    and n ~ '^[A-Za-z0-9À-ÖØ-öø-ÿĀ-ſ]+( [A-Za-z0-9À-ÖØ-öø-ÿĀ-ſ]+)?$'
    and public.is_clean(n)
$$;

-- Buddy-ID: 8 Zeichen aus 32 gut unterscheidbaren Zeichen (ohne 0, O, 1, I),
-- zufällig und nicht fortlaufend.
create or replace function public.new_buddy_id()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea; out text; i int;
begin
  loop
    b := extensions.gen_random_bytes(8); out := '';
    for i in 0..7 loop out := out || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.profiles p where p.buddy_id = out);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------
-- 2. Profile
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  buddy_id     text not null unique check (buddy_id ~ '^[A-HJ-NP-Z2-9]{8}$'),
  name         text check (name is null or public.valid_name(name)),
  avatar_path  text,
  share_weight boolean not null default false,   -- Körpergewicht für Freunde sichtbar
  legacy_name  text unique,                       -- „Manu“ / „Rob“ aus der Google-Tabelle
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                         -- Löschung beantragt, endgültig nach 30 Tagen
);

-- Bei jeder Registrierung entsteht automatisch ein Profil mit Buddy-ID.
-- Der Name folgt im Schritt „Zu dir“.
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, buddy_id) values (new.id, public.new_buddy_id())
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- Buddy-ID und Altname lassen sich nicht ändern
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.buddy_id is distinct from old.buddy_id or new.legacy_name is distinct from old.legacy_name or new.id is distinct from old.id then
    if current_setting('built.claiming', true) is distinct from 'on' then
      raise exception 'Buddy-ID und Altname sind fest';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- 3. Freunde, Blockieren
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  a            uuid not null references public.profiles (id) on delete cascade,
  b            uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (a, b),
  check (a < b)
);

create table if not exists public.blocks (
  blocker    uuid not null references public.profiles (id) on delete cascade,
  blocked    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.a = least(auth.uid(), other) and f.b = greatest(auth.uid(), other)
  )
$$;

create or replace function public.is_blocked_between(x uuid, y uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks k where (k.blocker = x and k.blocked = y) or (k.blocker = y and k.blocked = x))
$$;

-- ---------------------------------------------------------------------
-- 4. Crews
-- ---------------------------------------------------------------------
create table if not exists public.crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (public.valid_name(name)),
  avatar_path text,
  owner       uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.crew_members (
  crew_id   uuid not null references public.crews (id) on delete cascade,
  user_id   uuid not null unique references public.profiles (id) on delete cascade, -- eine Crew pro Person
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table if not exists public.crew_invites (
  crew_id    uuid not null references public.crews (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create or replace function public.my_crew()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.crew_id from public.crew_members m where m.user_id = auth.uid()
$$;

create or replace function public.is_crewmate(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.crew_members m1 join public.crew_members m2 on m1.crew_id = m2.crew_id
    where m1.user_id = auth.uid() and m2.user_id = other
  )
$$;

-- höchstens 6 Mitglieder
create or replace function public.crew_size_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.crew_members m where m.crew_id = new.crew_id) >= 6 then
    raise exception 'Eine Crew hat höchstens 6 Mitglieder';
  end if;
  return new;
end $$;
drop trigger if exists crew_size_guard on public.crew_members;
create trigger crew_size_guard before insert on public.crew_members
  for each row execute function public.crew_size_guard();

-- ---------------------------------------------------------------------
-- 5. Ereignis-Protokoll (wie heute die Google-Tabelle)
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id         text primary key check (char_length(id) <= 64),
  seq        bigint generated always as identity unique,   -- „seit“-Zeiger für den Abgleich
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  ts         timestamptz not null,
  type       text not null check (char_length(type) <= 40),
  summary    text check (char_length(summary) <= 4000),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 500000),
  plan_scope text check (plan_scope in ('mine', 'crew')),  -- gehört zu „Mein Plan“ oder zum Crew-Plan
  crew_id    uuid references public.crews (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists events_user_seq on public.events (user_id, seq);

-- ---------------------------------------------------------------------
-- 6. Übungsbibliothek: Grundstock (owner leer) plus eigene Übungen
-- ---------------------------------------------------------------------
create table if not exists public.library (
  id         text primary key check (char_length(id) <= 64),
  owner      uuid references public.profiles (id) on delete cascade,
  crew_id    uuid references public.crews (id) on delete set null,
  data       jsonb not null check (pg_column_size(data) <= 20000),
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Chat, Spots, Vault, Schlüssel (nur verschlüsselt)
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id         text primary key check (char_length(id) <= 64),
  sender     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient  uuid references public.profiles (id) on delete cascade,
  crew_id    uuid references public.crews (id) on delete cascade,
  ts         timestamptz not null default now(),
  iv         text not null check (char_length(iv) <= 64),
  ct         text not null check (char_length(ct) <= 20000),
  keys       jsonb,                                   -- je Empfänger verpackter Schlüssel
  expires_at timestamptz not null default now() + interval '30 days',
  check ((recipient is null) <> (crew_id is null))
);
create index if not exists messages_recipient on public.messages (recipient, ts);
create index if not exists messages_crew on public.messages (crew_id, ts);

create table if not exists public.spots (
  id         text primary key check (char_length(id) <= 64),
  owner      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  iv         text not null check (char_length(iv) <= 64),
  ct         text not null check (char_length(ct) <= 20000),   -- verschlüsselte Angaben (Tag, Text …)
  keys       jsonb,
  file_path  text                                               -- verschlüsseltes Bild im Speicher „spots“
);

create table if not exists public.spot_recipients (
  spot_id text not null references public.spots (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz,
  primary key (spot_id, user_id)
);

create table if not exists public.vault (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  id         text not null check (char_length(id) <= 64),
  created    timestamptz not null,
  body       text check (char_length(body) <= 12000000),   -- verschlüsselter Eintrag (Übernahme aus der Tabelle)
  file_path  text,                                          -- oder verschlüsselte Datei im Speicher „vault“
  primary key (user_id, id)
);

create table if not exists public.keys (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  device_id  text not null check (char_length(device_id) <= 64),
  public_key text not null check (char_length(public_key) <= 200),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------------
-- 8. Meldungen, Einwilligungen, Statistik, Fehler, Einstellungen
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('message', 'spot', 'profile', 'crew')),
  target_id   text not null check (char_length(target_id) <= 64),
  reason      text check (char_length(reason) <= 500),
  content     text check (char_length(content) <= 4000),   -- bei Chat/Spot die gemeldete Nachricht im Klartext
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

create table if not exists public.consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('privacy', 'terms', 'health', 'analytics')),
  version    text not null check (char_length(version) <= 20),
  granted    boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists consents_user_kind on public.consents (user_id, kind, created_at desc);

create or replace function public.has_consent(k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.granted from public.consents c where c.user_id = auth.uid() and c.kind = k order by c.created_at desc, c.id desc limit 1), false)
$$;

-- freiwillige Nutzungsstatistik: ohne Konto-ID, nur mit Einwilligung, Ablauf 90 Tage
create table if not exists public.usage_events (
  id          bigint generated always as identity primary key,
  anon_id     text not null check (char_length(anon_id) <= 40),
  name        text not null check (char_length(name) <= 60),
  app_version text check (char_length(app_version) <= 20),
  platform    text check (char_length(platform) <= 20),
  day         date not null default current_date,
  props       jsonb check (pg_column_size(props) <= 2000)
);

-- technisches Fehlerprotokoll: ohne Inhalte, Ablauf 30 Tage
create table if not exists public.error_log (
  id          bigint generated always as identity primary key,
  message     text not null check (char_length(message) <= 500),
  stack       text check (char_length(stack) <= 4000),
  app_version text check (char_length(app_version) <= 20),
  platform    text check (char_length(platform) <= 20),
  created_at  timestamptz not null default now()
);

-- Feedback aus der App (Idee, Fehler, Lob)
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('idee', 'fehler', 'lob')),
  text        text not null check (char_length(text) between 1 and 4000),
  app_version text check (char_length(app_version) <= 20),
  platform    text check (char_length(platform) <= 40),
  created_at  timestamptz not null default now()
);

create table if not exists public.app_config (
  key   text primary key,
  value jsonb not null
);
insert into public.app_config (key, value) values
  ('min_version', '"3.0.0"'::jsonb)
on conflict (key) do nothing;

-- Zähler für die Buddy-Suche (höchstens 20 pro Stunde)
create table if not exists public.search_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  ts      timestamptz not null default now()
);
create index if not exists search_log_user_ts on public.search_log (user_id, ts);

-- ---------------------------------------------------------------------
-- 9. Übernahme aus der Google-Tabelle (Zwischenablage für das Import-Skript)
-- ---------------------------------------------------------------------
create table if not exists public.legacy_events (
  id      text primary key,
  ts      timestamptz not null,
  person  text not null,
  type    text not null,
  summary text,
  data    jsonb not null default '{}'::jsonb
);
create table if not exists public.legacy_vault (
  person  text not null,
  id      text not null,
  created timestamptz not null,
  body    text,
  primary key (person, id)
);
create table if not exists public.legacy_library (
  id   text primary key,
  data jsonb not null
);
-- Übernahme-Codes: nur der Hash wird gespeichert
create table if not exists public.legacy_claims (
  legacy_name text primary key,
  code_hash   text not null,
  claimed_by  uuid references public.profiles (id) on delete set null,
  claimed_at  timestamptz
);

-- Hilfsfunktionen für Regeln, die sonst gegenseitig aufeinander verweisen würden
create or replace function public.is_spot_owner(s text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.spots x where x.id = s and x.owner = auth.uid())
$$;
create or replace function public.is_spot_recipient(s text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.spot_recipients r where r.spot_id = s and r.user_id = auth.uid())
$$;
create or replace function public.shares_weight(u uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.share_weight from public.profiles p where p.id = u), false)
$$;
-- Dateiordner im Speicher: darf ich die Dateien dieser Person (oder Crew) sehen?
create or replace function public.can_see_folder(f1 text, f2 text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare u uuid;
begin
  if f1 = 'crew' then return f2 is not null and f2 = public.my_crew()::text; end if;
  begin u := f1::uuid; exception when others then return false; end;
  return u = auth.uid() or public.is_friend(u) or public.is_crewmate(u);
end $$;
create or replace function public.owns_crew_folder(f2 text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crews c where c.id::text = f2 and c.owner = auth.uid())
$$;
create or replace function public.can_read_spot_file(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.spots s join public.spot_recipients r on r.spot_id = s.id
                 where s.file_path = path and r.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 10. Zugriffsregeln (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.banned_terms    enable row level security;
alter table public.profiles        enable row level security;
alter table public.friendships     enable row level security;
alter table public.blocks          enable row level security;
alter table public.crews           enable row level security;
alter table public.crew_members    enable row level security;
alter table public.crew_invites    enable row level security;
alter table public.events          enable row level security;
alter table public.library         enable row level security;
alter table public.messages        enable row level security;
alter table public.spots           enable row level security;
alter table public.spot_recipients enable row level security;
alter table public.vault           enable row level security;
alter table public.keys            enable row level security;
alter table public.reports         enable row level security;
alter table public.consents        enable row level security;
alter table public.usage_events    enable row level security;
alter table public.error_log       enable row level security;
alter table public.app_config      enable row level security;
alter table public.feedback        enable row level security;
alter table public.search_log      enable row level security;
alter table public.legacy_events   enable row level security;
alter table public.legacy_vault    enable row level security;
alter table public.legacy_library  enable row level security;
alter table public.legacy_claims   enable row level security;

-- Policies neu anlegen (beim zweiten Ausführen vorher entfernen)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Profile: sich selbst, Freunde und Crew sehen; nur sich selbst ändern
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_friend(id) or public.is_crewmate(id)
         or exists (select 1 from public.friendships f where f.status = 'pending' and f.a = least(auth.uid(), id) and f.b = greatest(auth.uid(), id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Freundschaften: nur Beteiligte sehen und auflösen; Anlegen und Annehmen über Funktionen
create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (a, b));
create policy friendships_delete on public.friendships for delete to authenticated
  using (auth.uid() in (a, b));

create policy blocks_all on public.blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Crews
create policy crews_select on public.crews for select to authenticated
  using (id = public.my_crew() or exists (select 1 from public.crew_invites i where i.crew_id = id and i.user_id = auth.uid()));
create policy crews_update on public.crews for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy crew_members_select on public.crew_members for select to authenticated
  using (crew_id = public.my_crew());
create policy crew_invites_select on public.crew_invites for select to authenticated
  using (user_id = auth.uid() or crew_id = public.my_crew());
create policy crew_invites_delete on public.crew_invites for delete to authenticated
  using (user_id = auth.uid() or invited_by = auth.uid());

-- Ereignisse: eigene schreiben; eigene, Freunde und Crew lesen.
-- Körpergewicht anderer nur, wenn sie es freigegeben haben.
create policy events_select on public.events for select to authenticated
  using (
    user_id = auth.uid()
    or ((public.is_friend(user_id) or public.is_crewmate(user_id))
        and (type <> 'bodyweight' or public.shares_weight(user_id)))
  );
create policy events_insert on public.events for insert to authenticated
  with check (user_id = auth.uid() and (crew_id is null or crew_id = public.my_crew()));

-- Bibliothek
create policy library_select on public.library for select to authenticated
  using (owner is null or owner = auth.uid() or (crew_id is not null and crew_id = public.my_crew()));
create policy library_insert on public.library for insert to authenticated
  with check (owner = auth.uid() and (crew_id is null or crew_id = public.my_crew()));
create policy library_update on public.library for update to authenticated
  using (owner = auth.uid() or (crew_id is not null and crew_id = public.my_crew()))
  with check (owner is not null and (crew_id is null or crew_id = public.my_crew()));

-- Nachrichten: nur an Freunde oder die eigene Crew, nicht bei Blockade
create policy messages_select on public.messages for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid() or (crew_id is not null and crew_id = public.my_crew()));
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender = auth.uid() and (
      (recipient is not null and public.is_friend(recipient) and not public.is_blocked_between(auth.uid(), recipient))
      or (crew_id is not null and crew_id = public.my_crew())
    )
  );
create policy messages_delete on public.messages for delete to authenticated
  using (sender = auth.uid());

-- Spots
create policy spots_select on public.spots for select to authenticated
  using (owner = auth.uid() or public.is_spot_recipient(id));
create policy spots_insert on public.spots for insert to authenticated
  with check (owner = auth.uid());
create policy spots_delete on public.spots for delete to authenticated
  using (owner = auth.uid());
create policy spot_recipients_select on public.spot_recipients for select to authenticated
  using (user_id = auth.uid() or public.is_spot_owner(spot_id));
create policy spot_recipients_insert on public.spot_recipients for insert to authenticated
  with check (public.is_spot_owner(spot_id)
              and (public.is_friend(user_id) or public.is_crewmate(user_id)));
create policy spot_recipients_update on public.spot_recipients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Vault: nur der Besitzer
create policy vault_all on public.vault for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Öffentliche Schlüssel
create policy keys_select on public.keys for select to authenticated
  using (user_id = auth.uid() or public.is_friend(user_id) or public.is_crewmate(user_id));
create policy keys_write on public.keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Melden: nur anlegen (lesen nur der Betreiber im Dashboard)
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter = auth.uid());

-- Einwilligungen: eigene anlegen und lesen, nie ändern (Verlauf bleibt nachvollziehbar)
create policy consents_select on public.consents for select to authenticated using (user_id = auth.uid());
create policy consents_insert on public.consents for insert to authenticated with check (user_id = auth.uid());

-- Statistik nur mit Einwilligung, Fehler immer (ohne Inhalte). Lesen nur der Betreiber.
create policy usage_insert on public.usage_events for insert to authenticated with check (public.has_consent('analytics'));
create policy errors_insert on public.error_log for insert to anon, authenticated with check (true);

create policy feedback_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy app_config_select on public.app_config for select to anon, authenticated using (true);
-- banned_terms, search_log und legacy_*: keine Regeln = kein Zugriff aus der App

-- ---------------------------------------------------------------------
-- 11. Funktionen für die App
-- ---------------------------------------------------------------------

-- Buddy per ID finden: nur Name, Bild, ID. Höchstens 20 Suchen pro Stunde.
create or replace function public.find_buddy(code text)
returns table (id uuid, buddy_id text, name text, avatar_path text)
language plpgsql security definer set search_path = '' as $$
declare c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if (select count(*) from public.search_log s where s.user_id = auth.uid() and s.ts > now() - interval '1 hour') >= 20 then
    raise exception 'Zu viele Suchen. Bitte später noch einmal.';
  end if;
  insert into public.search_log (user_id) values (auth.uid());
  return query
    select p.id, p.buddy_id, p.name, p.avatar_path from public.profiles p
    where p.buddy_id = c and p.deleted_at is null and p.name is not null and p.id <> auth.uid()
      and not public.is_blocked_between(auth.uid(), p.id);
end $$;

-- Freundschaftsanfrage senden; liegt schon eine Gegenanfrage vor, wird sie angenommen
create or replace function public.send_friend_request(target uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); f public.friendships;
begin
  if me is null or target is null or target = me then raise exception 'Ungültig'; end if;
  if public.is_blocked_between(me, target) then raise exception 'Nicht möglich'; end if;
  select * into f from public.friendships x where x.a = least(me, target) and x.b = greatest(me, target);
  if found then
    if f.status = 'pending' and f.requested_by <> me then
      update public.friendships x set status = 'accepted', accepted_at = now() where x.a = f.a and x.b = f.b;
      return 'accepted';
    end if;
    return f.status;
  end if;
  insert into public.friendships (a, b, requested_by) values (least(me, target), greatest(me, target), me);
  return 'pending';
end $$;

create or replace function public.respond_friend_request(other uuid, accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if accept then
    update public.friendships f set status = 'accepted', accepted_at = now()
      where f.a = least(me, other) and f.b = greatest(me, other) and f.status = 'pending' and f.requested_by = other;
  else
    delete from public.friendships f
      where f.a = least(me, other) and f.b = greatest(me, other) and f.status = 'pending' and f.requested_by = other;
  end if;
end $$;

-- Blockieren beendet auch eine Freundschaft
create or replace function public.block_user(other uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  insert into public.blocks (blocker, blocked) values (me, other) on conflict do nothing;
  delete from public.friendships f where f.a = least(me, other) and f.b = greatest(me, other);
end $$;

-- Crew gründen
create or replace function public.create_crew(crew_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c uuid;
begin
  if public.my_crew() is not null then raise exception 'Du bist schon in einer Crew'; end if;
  insert into public.crews (name, owner) values (crew_name, me) returning id into c;
  insert into public.crew_members (crew_id, user_id, role) values (c, me, 'owner');
  return c;
end $$;

-- Freund einladen (nur der Chef)
create or replace function public.invite_to_crew(friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c uuid := public.my_crew();
begin
  if c is null or not exists (select 1 from public.crews x where x.id = c and x.owner = me) then raise exception 'Nur der Crew-Chef lädt ein'; end if;
  if not public.is_friend(friend) then raise exception 'Nur Freunde einladen'; end if;
  insert into public.crew_invites (crew_id, user_id, invited_by) values (c, friend, me) on conflict do nothing;
end $$;

create or replace function public.join_crew(crew uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from public.crew_invites i where i.crew_id = crew and i.user_id = me) then raise exception 'Keine Einladung'; end if;
  if public.my_crew() is not null then raise exception 'Erst die alte Crew verlassen'; end if;
  insert into public.crew_members (crew_id, user_id) values (crew, me);
  delete from public.crew_invites i where i.user_id = me;
end $$;

-- Crew verlassen: Chef-Rolle geht an das älteste Mitglied, leere Crews verschwinden
create or replace function public.leave_crew()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c uuid := public.my_crew(); nxt uuid;
begin
  if c is null then return; end if;
  delete from public.crew_members m where m.crew_id = c and m.user_id = me;
  select m.user_id into nxt from public.crew_members m where m.crew_id = c order by m.joined_at limit 1;
  if nxt is null then
    delete from public.crews x where x.id = c;
  elsif exists (select 1 from public.crews x where x.id = c and x.owner = me) then
    update public.crews x set owner = nxt where x.id = c;
    update public.crew_members m set role = 'owner' where m.crew_id = c and m.user_id = nxt;
  end if;
end $$;

-- Konto löschen (endgültig nach 30 Tagen, bis dahin rückgängig machbar)
create or replace function public.request_account_deletion()
returns void language sql security definer set search_path = '' as $$
  update public.profiles p set deleted_at = now() where p.id = auth.uid();
$$;
create or replace function public.cancel_account_deletion()
returns void language sql security definer set search_path = '' as $$
  update public.profiles p set deleted_at = null where p.id = auth.uid();
$$;

-- Eigene Daten exportieren (verschlüsselte Inhalte bleiben verschlüsselt)
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile',  (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'events',   coalesce((select jsonb_agg(to_jsonb(e) order by e.seq) from public.events e where e.user_id = auth.uid()), '[]'::jsonb),
    'library',  coalesce((select jsonb_agg(to_jsonb(l)) from public.library l where l.owner = auth.uid()), '[]'::jsonb),
    'friends',  coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where auth.uid() in (f.a, f.b)), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.consents c where c.user_id = auth.uid()), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.ts) from public.messages m where m.sender = auth.uid()), '[]'::jsonb),
    'vault',    coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'created', v.created)) from public.vault v where v.user_id = auth.uid()), '[]'::jsonb)
  )
$$;

-- Altes Profil übernehmen: Code aus dem Import einlösen. Holt Trainings, Vault
-- und Bibliothek herüber; sind beide Altprofile übernommen, werden die beiden
-- Freunde und bekommen gemeinsam eine Crew mit dem bisherigen Plan.
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
  delete from public.legacy_library;

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

-- ---------------------------------------------------------------------
-- 12. Rechte (nichts ist automatisch freigegeben)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select, update (name, avatar_path, share_weight) on public.profiles to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, update (name, avatar_path) on public.crews to authenticated;
grant select on public.crew_members to authenticated;
grant select, delete on public.crew_invites to authenticated;
grant select, insert on public.events to authenticated;
grant select, insert, update on public.library to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, delete on public.spots to authenticated;
grant select, insert, update (seen_at) on public.spot_recipients to authenticated;
grant select, insert, update, delete on public.vault to authenticated;
grant select, insert, update, delete on public.keys to authenticated;
grant insert on public.reports to authenticated;
grant select, insert on public.consents to authenticated;
grant insert on public.usage_events to authenticated;
grant insert on public.error_log to anon, authenticated;
grant insert on public.feedback to authenticated;
grant select on public.app_config to anon, authenticated;

-- Das Import-Skript arbeitet mit dem secret key (Rolle service_role) und braucht Zugriff auf alles
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Funktionen, die in Zugriffsregeln stecken, brauchen Ausführungsrecht
grant execute on function public.is_friend(uuid), public.is_crewmate(uuid), public.my_crew(),
  public.is_blocked_between(uuid, uuid), public.has_consent(text), public.valid_name(text),
  public.is_clean(text), public.norm_text(text), public.is_spot_owner(text), public.is_spot_recipient(text),
  public.shares_weight(uuid), public.can_see_folder(text, text), public.owns_crew_folder(text),
  public.can_read_spot_file(text) to authenticated;
grant execute on function public.find_buddy(text), public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean), public.block_user(uuid), public.create_crew(text),
  public.invite_to_crew(uuid), public.join_crew(uuid), public.leave_crew(),
  public.request_account_deletion(), public.cancel_account_deletion(), public.export_my_data(),
  public.claim_legacy(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. Dateispeicher (privat) mit Regeln
--     Pfade: avatars/<user-id>/…, avatars/crew/<crew-id>/…,
--            spots/<user-id>/…, vault/<user-id>/…
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', false, 1048576,  array['image/webp', 'image/jpeg', 'image/png']),
  ('spots',   'spots',   false, 5242880,  array['application/octet-stream']),
  ('vault',   'vault',   false, 15728640, array['application/octet-stream'])
on conflict (id) do nothing;

drop policy if exists built_avatars_read  on storage.objects;
drop policy if exists built_avatars_write on storage.objects;
drop policy if exists built_spots_read    on storage.objects;
drop policy if exists built_spots_write   on storage.objects;
drop policy if exists built_vault_all     on storage.objects;

create policy built_avatars_read on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and public.can_see_folder((storage.foldername(name))[1], (storage.foldername(name))[2]));
create policy built_avatars_write on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
         or ((storage.foldername(name))[1] = 'crew' and public.owns_crew_folder((storage.foldername(name))[2]))))
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text
         or ((storage.foldername(name))[1] = 'crew' and public.owns_crew_folder((storage.foldername(name))[2]))));

create policy built_spots_read on storage.objects for select to authenticated using (
  bucket_id = 'spots' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_read_spot_file(name)));
create policy built_spots_write on storage.objects for all to authenticated
  using (bucket_id = 'spots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'spots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy built_vault_all on storage.objects for all to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 14. Echtzeit für Abgleich, Chat, Freunde und Crew
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['events', 'messages', 'friendships', 'crew_members', 'crew_invites', 'spot_recipients'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 15. Tägliches Aufräumen (3:15 Uhr UTC)
--     Dateien im Speicher räumt später eine kleine Edge Function auf,
--     weil Supabase das Löschen von Dateien per SQL nicht erlaubt.
-- ---------------------------------------------------------------------
create or replace function public.daily_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.messages m where m.expires_at < now();
  delete from public.spots s where s.expires_at < now();
  delete from public.usage_events u where u.day < current_date - 90;
  delete from public.error_log e where e.created_at < now() - interval '30 days';
  delete from public.search_log s where s.ts < now() - interval '1 day';
  delete from auth.users u where u.id in (select p.id from public.profiles p where p.deleted_at < now() - interval '30 days');
end $$;
revoke all on function public.daily_cleanup() from public, anon, authenticated;

select cron.schedule('built-daily-cleanup', '15 3 * * *', 'select public.daily_cleanup()');
