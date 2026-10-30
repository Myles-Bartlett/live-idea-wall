-- Live Idea Wall — reset for the real event
--
-- !! This permanently deletes EVERY idea, every support and every follow-up email. !!
-- !! It cannot be undone. Download a CSV from the facilitator panel first.          !!
--
-- Use it once, after rehearsals and before the summit opens.
-- (For rehearsals, use "Load sample ideas" / "Remove all sample ideas" in the
-- facilitator panel instead: that leaves real ideas alone.)
--
-- Paste into Supabase: SQL Editor > New query > Run.
-- Facilitator accounts are NOT touched.

begin;

-- Follow-up emails go with their ideas (on delete cascade).
delete from public.ideas;

-- Settings back to the start: default notes, no synthesis, live wall, "Something else" on.
update public.settings set
  notes      = array[
                 'Every idea on this wall came from someone who stopped at this booth.',
                 'Tap any note to read it in full, support it, or build on it.'
               ],
  summary    = '',
  show_other = true,
  view       = 'wall',
  updated_at = now()
where id = 1;

commit;

-- Check: both should say 0.
select (select count(*) from public.ideas) as ideas_left,
       (select count(*) from public.followups) as emails_left;
