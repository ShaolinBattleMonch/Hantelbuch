-- BUILT · Anpassung 02: längere Trainings-Zusammenfassungen erlauben
-- (eure Tabelle enthält Zusammenfassungen mit bis zu ca. 600 Zeichen)
alter table public.events drop constraint if exists events_summary_check;
alter table public.events add constraint events_summary_check check (char_length(summary) <= 4000);
alter table public.events drop constraint if exists events_data_check;
alter table public.events add constraint events_data_check check (pg_column_size(data) <= 500000);
