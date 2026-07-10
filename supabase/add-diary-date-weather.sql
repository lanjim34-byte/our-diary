alter table public.diary_entries
add column if not exists diary_date date;

alter table public.diary_entries
add column if not exists weather text;
