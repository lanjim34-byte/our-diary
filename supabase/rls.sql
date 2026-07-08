alter table public.profiles enable row level security;
alter table public.notebooks enable row level security;
alter table public.notebook_members enable row level security;
alter table public.diary_entries enable row level security;
alter table public.diary_followups enable row level security;
alter table public.paper_notes enable row level security;
alter table public.stamps enable row level security;
alter table public.highlights enable row level security;

create or replace function public.is_notebook_member(p_notebook_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.notebook_members
    where notebook_id = p_notebook_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_read_diary(p_diary_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.diary_entries d
    join public.notebook_members m on m.notebook_id = d.notebook_id
    where d.id = p_diary_id
      and m.user_id = auth.uid()
  );
$$;

create policy "profiles are visible to shared notebook members"
on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.notebook_members mine
    join public.notebook_members theirs on theirs.notebook_id = mine.notebook_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);

create policy "users insert own profile"
on public.profiles for insert
with check (id = auth.uid());

create policy "users update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "members read notebooks"
on public.notebooks for select
using (public.is_notebook_member(id));

create policy "members read notebook memberships"
on public.notebook_members for select
using (public.is_notebook_member(notebook_id));

create policy "members read diary entries"
on public.diary_entries for select
using (public.is_notebook_member(notebook_id));

create policy "members create diary entries"
on public.diary_entries for insert
with check (author_id = auth.uid() and public.is_notebook_member(notebook_id));

create policy "authors update diary entries"
on public.diary_entries for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "authors delete diary entries"
on public.diary_entries for delete
using (author_id = auth.uid());

create policy "members read followups"
on public.diary_followups for select
using (public.can_read_diary(diary_id));

create policy "authors add followups to own diary"
on public.diary_followups for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.diary_entries
    where id = diary_id and author_id = auth.uid()
  )
);

create policy "authors update own followups"
on public.diary_followups for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "authors delete own followups"
on public.diary_followups for delete
using (author_id = auth.uid());

create policy "members read paper notes"
on public.paper_notes for select
using (public.can_read_diary(diary_id));

create policy "members add paper notes"
on public.paper_notes for insert
with check (author_id = auth.uid() and public.can_read_diary(diary_id));

create policy "authors update own paper notes"
on public.paper_notes for update
using (author_id = auth.uid())
with check (author_id = auth.uid());

create policy "authors delete own paper notes"
on public.paper_notes for delete
using (author_id = auth.uid());

create policy "members read stamps"
on public.stamps for select
using (public.can_read_diary(diary_id));

create policy "members add stamps"
on public.stamps for insert
with check (author_id = auth.uid() and public.can_read_diary(diary_id));

create policy "authors delete own stamps"
on public.stamps for delete
using (author_id = auth.uid());

create policy "members read highlights"
on public.highlights for select
using (public.can_read_diary(diary_id));

create policy "members add highlights"
on public.highlights for insert
with check (author_id = auth.uid() and public.can_read_diary(diary_id));

create policy "authors delete own highlights"
on public.highlights for delete
using (author_id = auth.uid());
