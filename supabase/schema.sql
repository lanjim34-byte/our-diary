create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '新朋友',
  avatar_initial text not null default '友',
  created_at timestamptz not null default now()
);

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我们的小本子',
  invite_code text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.notebook_members (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (notebook_id, user_id)
);

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  mood text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diary_followups (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.diary_entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_notes (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.diary_entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.diary_entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  stamp_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.diary_entries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  start_index int not null,
  end_index int not null,
  created_at timestamptz not null default now(),
  check (start_index >= 0 and end_index > start_index)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists diary_entries_set_updated_at on public.diary_entries;
create trigger diary_entries_set_updated_at
before update on public.diary_entries
for each row execute function public.set_updated_at();

create or replace function public.create_notebook(p_name text default '我们的小本子')
returns public.notebooks
language plpgsql
security definer
set search_path = public
as $$
declare
  created_notebook public.notebooks;
  code text;
begin
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.notebooks (name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), '我们的小本子'), code, auth.uid())
  returning * into created_notebook;

  insert into public.notebook_members (notebook_id, user_id, role)
  values (created_notebook.id, auth.uid(), 'owner');

  return created_notebook;
end;
$$;

create or replace function public.join_notebook_by_code(p_invite_code text)
returns public.notebooks
language plpgsql
security definer
set search_path = public
as $$
declare
  target_notebook public.notebooks;
begin
  select *
  into target_notebook
  from public.notebooks
  where invite_code = upper(trim(p_invite_code));

  if target_notebook.id is null then
    raise exception 'invite code not found';
  end if;

  insert into public.notebook_members (notebook_id, user_id, role)
  values (target_notebook.id, auth.uid(), 'member')
  on conflict (notebook_id, user_id) do nothing;

  return target_notebook;
end;
$$;
