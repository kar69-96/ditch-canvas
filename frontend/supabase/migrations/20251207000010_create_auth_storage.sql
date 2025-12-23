-- Canvas auth storage and tables

-- Storage bucket for per-user data
insert into storage.buckets (id, name, public)
values ('user-data', 'user-data', false)
on conflict (id) do nothing;

-- Users table (minimal)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  identikey text unique,
  canvas_user_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Sessions table
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Canvas auth logs
create table if not exists public.canvas_auth_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  identikey text,
  success boolean default false,
  created_at timestamptz default now()
);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.canvas_auth_logs enable row level security;

-- Basic RLS allowing users to access their own rows by email/identikey match
create policy if not exists "Users can select own row"
on public.users for select
using (auth.uid() = id);

create policy if not exists "Users can select own sessions"
on public.sessions for select
using (auth.uid() = user_id);

create policy if not exists "Users can select own auth logs"
on public.canvas_auth_logs for select
using (auth.uid() = user_id);

-- Storage policies (per-folder)
create policy if not exists "Users read own folder"
on storage.objects for select
using (bucket_id = 'user-data' and position(auth.uid()::text, name) = 1);

create policy if not exists "Users write own folder"
on storage.objects for insert
with check (bucket_id = 'user-data' and position(auth.uid()::text, name) = 1);





