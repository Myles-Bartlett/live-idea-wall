-- Live Idea Wall — Supabase schema
-- Paste this whole file into Supabase: SQL Editor > New query > Run.
-- Safe to run once on a fresh project.

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  text        text not null check (char_length(btrim(text)) between 3 and 280),
  area        text not null check (area in
                ('talent','innovation','productivity','community','industry','students','other')),
  name        text check (name is null or char_length(name) <= 80),
  parent_id   uuid references public.ideas(id) on delete set null,   -- posted as a reply ("Build on this idea")
  stack_id    uuid references public.ideas(id) on delete set null,   -- grouped into this stack by a facilitator
  votes       integer not null default 0 check (votes >= 0),
  hidden      boolean not null default false,
  solo        boolean not null default false,   -- facilitator split it out of an auto-stack
  is_sample   boolean not null default false,   -- test data; remove before the event
  source      text not null default 'web' check (char_length(source) <= 20),
  feeling     text check (feeling is null or feeling in   -- optional; list matches js/feelings.js
                ('hopeful','excited','confident','proud','worried','frustrated','uncertain','impatient'))
);
create index if not exists ideas_created_idx on public.ideas (created_at);

create table if not exists public.settings (
  id          int primary key default 1 check (id = 1),   -- exactly one row
  notes       text[] not null default array[
                'Every idea on this wall came from someone who stopped at this booth.',
                'Tap any note to read it in full, support it, or build on it.'
              ],
  summary     text not null default '',
  show_other  boolean not null default true,
  view        text not null default 'wall' check (view in ('wall','summary')),
  updated_at  timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- Optional email for a follow-up. Kept OUT of the ideas table on purpose:
-- ideas are readable by anyone, these are readable only by facilitators.
create table if not exists public.followups (
  idea_id     uuid primary key references public.ideas(id) on delete cascade,
  email       text not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.facilitators (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  label     text,
  added_at  timestamptz not null default now()
);

-- ---------- Helpers ----------
create or replace function public.is_facilitator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.facilitators where user_id = auth.uid());
$$;

-- The only way the public can change votes: +1 at a time.
create or replace function public.support_idea(idea_id uuid)
returns integer language sql security definer set search_path = public as $$
  update public.ideas set votes = votes + 1
  where id = idea_id and hidden = false
  returning votes;
$$;
revoke all on function public.support_idea(uuid) from public;
grant execute on function public.support_idea(uuid) to anon, authenticated;

-- ---------- Row Level Security ----------
alter table public.ideas        enable row level security;
alter table public.settings     enable row level security;
alter table public.facilitators enable row level security;
alter table public.followups    enable row level security;

-- Ideas: everyone can read (client filters hidden ones, so hide events reach every screen).
create policy "ideas readable by all" on public.ideas
  for select to anon, authenticated using (true);

-- Anyone can post a plain idea; only facilitators can set votes/hidden/sample on insert.
create policy "anyone can post ideas" on public.ideas
  for insert to anon, authenticated
  with check (
    public.is_facilitator()
    or (votes = 0 and hidden = false and solo = false and is_sample = false and stack_id is null)
  );

create policy "facilitators edit ideas" on public.ideas
  for update to authenticated
  using (public.is_facilitator()) with check (public.is_facilitator());

create policy "facilitators delete ideas" on public.ideas
  for delete to authenticated using (public.is_facilitator());

-- Follow-up emails: anyone can leave one for a recent idea; only facilitators
-- can read or delete them. Not added to Realtime, so they are never broadcast.
create policy "anyone can leave a follow-up email" on public.followups
  for insert to anon, authenticated
  with check (exists (select 1 from public.ideas i
                      where i.id = idea_id and i.created_at > now() - interval '1 day'));

create policy "facilitators read follow-up emails" on public.followups
  for select to authenticated using (public.is_facilitator());

create policy "facilitators delete follow-up emails" on public.followups
  for delete to authenticated using (public.is_facilitator());

-- Settings: everyone reads, facilitators change.
create policy "settings readable by all" on public.settings
  for select to anon, authenticated using (true);

create policy "facilitators edit settings" on public.settings
  for update to authenticated
  using (public.is_facilitator()) with check (public.is_facilitator());

-- Facilitators table: a signed-in user can see only their own row.
create policy "see own facilitator row" on public.facilitators
  for select to authenticated using (user_id = auth.uid());

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.ideas;
alter publication supabase_realtime add table public.settings;

-- ---------- Adding a facilitator (run separately, after creating the user) ----------
-- 1. Authentication > Users > Add user > Create new user (email + password, auto-confirm).
-- 2. Then run, with their email:
--    insert into public.facilitators (user_id, label)
--    select id, email from auth.users where email = 'someone@sheridancollege.ca';
