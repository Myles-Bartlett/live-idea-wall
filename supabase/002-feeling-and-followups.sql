-- Live Idea Wall — update 2: feelings and follow-up emails
-- For a database that already ran schema.sql BEFORE this update.
-- Paste into Supabase: SQL Editor > New query > Run. Safe to run more than once.
-- (A fresh project only needs schema.sql, which already includes this.)

-- 1. Optional feeling on each idea (four positive, four negative words).
alter table public.ideas add column if not exists feeling text
  check (feeling is null or feeling in
    ('hopeful','excited','confident','proud','worried','frustrated','uncertain','impatient'));

-- 2. Optional follow-up email, in its own table so it is never public.
create table if not exists public.followups (
  idea_id     uuid primary key references public.ideas(id) on delete cascade,
  email       text not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  created_at  timestamptz not null default now()
);
alter table public.followups enable row level security;

drop policy if exists "anyone can leave a follow-up email" on public.followups;
create policy "anyone can leave a follow-up email" on public.followups
  for insert to anon, authenticated
  with check (exists (select 1 from public.ideas i
                      where i.id = idea_id and i.created_at > now() - interval '1 day'));

drop policy if exists "facilitators read follow-up emails" on public.followups;
create policy "facilitators read follow-up emails" on public.followups
  for select to authenticated using (public.is_facilitator());

drop policy if exists "facilitators delete follow-up emails" on public.followups;
create policy "facilitators delete follow-up emails" on public.followups
  for delete to authenticated using (public.is_facilitator());

-- Tell the API about the new column straight away.
notify pgrst, 'reload schema';
