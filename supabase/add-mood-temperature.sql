alter table public.diary_entries
add column if not exists mood_tone text;

alter table public.diary_entries
add column if not exists mood_words jsonb;
