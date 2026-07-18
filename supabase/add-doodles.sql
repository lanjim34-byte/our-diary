alter table public.diary_entries
add column if not exists doodle_url text;

create table if not exists public.doodles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.doodles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'doodles'
      and policyname = 'doodles are visible to notebook members'
  ) then
    create policy "doodles are visible to notebook members"
    on public.doodles
    for select
    using (
      user_id = auth.uid()
      or (
        notebook_id is not null
        and exists (
          select 1
          from public.notebook_members
          where notebook_members.notebook_id = doodles.notebook_id
            and notebook_members.user_id = auth.uid()
        )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'doodles'
      and policyname = 'users create their own doodles'
  ) then
    create policy "users create their own doodles"
    on public.doodles
    for insert
    with check (
      user_id = auth.uid()
      and (
        notebook_id is null
        or exists (
          select 1
          from public.notebook_members
          where notebook_members.notebook_id = doodles.notebook_id
            and notebook_members.user_id = auth.uid()
        )
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'doodles'
      and policyname = 'users delete their own doodles'
  ) then
    create policy "users delete their own doodles"
    on public.doodles
    for delete
    using (user_id = auth.uid());
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('doodles', 'doodles', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'doodle images are publicly readable'
  ) then
    create policy "doodle images are publicly readable"
    on storage.objects
    for select
    using (bucket_id = 'doodles');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users upload doodles to their folder'
  ) then
    create policy "users upload doodles to their folder"
    on storage.objects
    for insert
    with check (
      bucket_id = 'doodles'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users update doodles in their folder'
  ) then
    create policy "users update doodles in their folder"
    on storage.objects
    for update
    using (
      bucket_id = 'doodles'
      and auth.uid()::text = (storage.foldername(name))[1]
    )
    with check (
      bucket_id = 'doodles'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'users delete doodles in their folder'
  ) then
    create policy "users delete doodles in their folder"
    on storage.objects
    for delete
    using (
      bucket_id = 'doodles'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  end if;
end $$;
