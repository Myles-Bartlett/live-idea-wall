-- Live Idea Wall — update 3: facilitator stacking
-- For a database that already ran schema.sql (and update 2) BEFORE this update.
-- Paste into Supabase: SQL Editor > New query > Run. Safe to run more than once.

-- When a facilitator drags one note onto another, the moved ideas point at
-- the stack they now belong to. Kept separate from parent_id, which means
-- "this was posted as a reply (Build on this idea)".
alter table public.ideas add column if not exists stack_id uuid
  references public.ideas(id) on delete set null;

-- The public can still post, but only facilitators can place an idea in a stack.
drop policy if exists "anyone can post ideas" on public.ideas;
create policy "anyone can post ideas" on public.ideas
  for insert to anon, authenticated
  with check (
    public.is_facilitator()
    or (votes = 0 and hidden = false and solo = false and is_sample = false and stack_id is null)
  );

notify pgrst, 'reload schema';
