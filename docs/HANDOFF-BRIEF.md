# Handoff brief: Live Idea Wall, web edition

## Goal
Turn the `EARLY TEST/` prototype into a public website (GitHub Pages + Supabase) that:
1. keeps the EARLY TEST look and layout,
2. lets delegates submit ideas from the page itself (big screen, tablets, phones via QR),
3. updates every screen live from one shared database, and
4. gives facilitators a signed-in way to curate the wall.

## Step 0 — before writing code
1. Read `EARLY TEST/` fully. Summarise for Myles: files, how it renders, how it gets data,
   what the visual system is (fonts, colours, spacing, column layout, note style).
2. Read `reference/hub-edition.html` for behaviour. List which behaviours EARLY TEST already
   has and which it lacks.
3. Propose a file structure and plan, and wait for Myles's OK.

## Requirements (from Sheridan's proposal to Colleges Ontario — these are pass/fail on site)
| # | Promise | On the floor |
|---|---|---|
| R1 | One central question | Largest thing on screen, readable from ~4 m |
| R2 | Colour-coded notes | Coded by area; also labelled (not hue alone) |
| R3 | Six opportunity areas | Talent, Innovation, Productivity, Community Resilience, Industry Transformation, Student Success, plus "Something else" (toggleable) |
| R4 | Contributor picks the area | Area chosen in the submit form |
| R5 | Review others' ideas | Existing ideas readable before/after posting |
| R6 | Build on others' ideas | "Build on this idea" posts a response that joins that idea's stack |
| R7 | Cluster related ideas | Near-duplicates auto-stack with a visible ×N badge; facilitators split/merge |
| R8 | Identify strongest ideas | Support (upvote) reorders; dot-row visual, not a growing number |
| R9 | Return to see change | Running total + "added today"; "Find my idea" |
| R10 | Facilitators synthesise | Rotating facilitators' notes banner, edited live |
| R11 | Closing summary | A designed summary state: synthesis text, most supported, best per area |

Design commitments: legible at four metres in four seconds; contributing takes under 60 seconds
(idea, area, optional name — nothing else); software sorts and stacks, humans decide meaning.

## UX to refine
- **Submit flow (phone/tablet, `#add`)**: one screen, three fields in order: idea (soft cap ~200
  chars, hard cap 280), area (seven large chips), name and college (optional, say so). Big
  "Post to the wall" button. Confirmation screen says where to look ("Look for the outlined note
  in Talent") and offers "Support other ideas" and "Add another". Works one-handed on a phone.
- **See it land**: new notes animate in and keep a highlight for ~2 minutes at the top of their
  column so the poster can point at it. Target: on screen within ~2 s of posting.
- **Support**: tap a note → detail sheet → "Support this idea". One support per idea per device
  (localStorage), shown with a cooldown state. Server increments via `support_idea()` RPC.
- **Build on this idea**: from the detail sheet; the response stores `parent_id` and joins the stack.
- **Kiosk tablets**: `#add?kiosk` (or similar) resets to a blank form ~20 s after posting.
- **Connection state**: small indicator ("Live" / "Reconnecting…"). If offline, queue posts
  locally and send when back; never lose a typed idea. On reconnect, refetch everything.
- **Wall density**: never scroll a column; cap with "+N more"; step type size down at volume
  thresholds (see the reference file's `dense1`/`dense2`).

## Facilitators
- Sign in with Supabase Auth (email + password) from a small gear icon. No shared PIN.
- Signed-in facilitators can: hide/unhide notes, move a stack to another area, merge (drag note
  onto note), split a stack, edit the rotating notes, write the closing synthesis, switch
  wall ↔ summary, load/remove clearly tagged sample ideas, export all ideas as CSV/JSON.
- Moderation rule (show in the panel): hide personal attacks and identifiable complaints;
  do not hide criticism of policy.
- Auto sign-out of facilitator mode after 10 idle minutes on the Hub.

## Data model (see `supabase/schema.sql`)
- `ideas`: id, created_at, text, area, name, parent_id, votes, hidden, solo, is_sample, source.
- `settings`: single row: notes[], summary, show_other, view ('wall' | 'summary').
- `facilitators`: user ids allowed to curate.
- `support_idea(idea_id)`: the only way the public changes votes.
- Realtime is on for `ideas` and `settings`. Subscribe to postgres changes and also do a full
  refetch on load, on reconnect, and every ~60 s as a safety net.
- Hidden ideas are readable by the API (so hide events reach every screen) and filtered in the
  client. That is a deliberate trade-off.

## Config
- `config.js` (committed): `window.WALL_CONFIG = { supabaseUrl, supabaseKey }` using the
  **publishable/anon** key. Copy from `config.example.js`.

## Deployment
- GitHub Pages from `main`, root folder. Add a short `README.md` for the student team: how to
  run locally (`python3 -m http.server`), how to deploy, how to add a facilitator, how to reset
  the wall for a rehearsal vs the real event.
- Add a QR code (generated as a static SVG/PNG in the repo) pointing at the live `#add` URL.

## Acceptance tests (do these before calling it done)
1. Post from a phone → appears on the wall in another browser within ~2 s, highlighted.
2. Support the same idea twice from one device → second tap is blocked; total increments by 1.
3. Not signed in: attempt to update/delete a row with the browser console → refused by Supabase.
4. Facilitator hides a note → disappears from all open screens.
5. Build on an idea → response joins that stack and the ×N badge updates.
6. Load 400 sample ideas → no column scrolls, "+N more" correct, wall stays readable at 1920x1080.
7. Kill the network mid-post → idea is queued, then posts on reconnect.
8. Closing summary renders the synthesis, top 5 supported, and best idea per area.
9. Works in Edge (Windows) and iOS Safari.
