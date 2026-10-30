# Live Idea Wall — project context for Claude Code

## What this is
An interactive "digital sticky note" wall for Sheridan College's exhibit at the Colleges Ontario
Powering Growth Expo (2026 Higher Education Summit). Delegates answer one question:

> How might Ontario's colleges power growth over the next ten years?

Ideas land live on a large touch screen (a Microsoft Surface Hub running Edge), colour-coded into
six opportunity areas plus "Something else". Delegates support (upvote) ideas, build on others'
ideas, and facilitators curate the wall and switch it to a closing summary at the end.

Owner: Myles (Associate Dean, FAAD, Sheridan). A student and faculty team will pick up pieces of
this later, so keep the code readable and the docs current.

## Folder map
- `index.html`, `add.html`, `sign.html` — the wall, the phone/tablet form (`/#add` redirects
  here; `?kiosk` for booth tablets), and the printable QR sign. `?demo` uses sample data only.
- `css/`, `js/` — the site. `README.md` has a table of what each file does.
- `early test/` — the prototype whose LOOK and LAYOUT are the target. Treat its visual design
  (type, colour, spacing, column layout, note style) as the source of truth. Do not redesign it.
- `reference/hub-edition.html` — a later single-file rebuild with more complete BEHAVIOUR
  (build-on-this-idea, find my idea, facilitator hide/split/merge, closing summary, stacking,
  vote cooldown). Use it as a behaviour reference only. Its storage code (`window.claude.use`)
  only works on claude.ai and must be replaced, not copied.
- `docs/HANDOFF-BRIEF.md` — the job: requirements, architecture, data model, acceptance tests.
- `docs/ACCEPTANCE-TESTS.md` — test results, and what still needs real hardware.
- `supabase/schema.sql` — database tables, security rules and realtime setup (a fresh project).
  `002-…` and `003-…` are updates already run on the live project; `reset-for-event.sql`
  deletes every idea (only for Myles to run, once, before the event).
- `config.example.js` — template for the public Supabase settings.
- `Supabase Details/`, `SupabaseDetails*` — Myles's private notes with passwords. Git-ignored.
  Never read, commit or publish them.

## Architecture (decided)
- Static site (HTML/CSS/vanilla JS, no build step) hosted on **GitHub Pages**.
- **Supabase** (Postgres + Realtime + Auth) is the shared database. Every screen (Hub, tablets,
  phones) reads and writes the same data and updates live.
- Supabase JS client loaded from a CDN with an **exact pinned version**.
- Two entry points on one site: the wall (`/`) and a phone/tablet submission view
  (`/#add`, the QR code target). A separate `add.html` is fine if cleaner.
- No Python server, no OneDrive/Microsoft Forms polling. Delegates submit through the page itself.
- Live at https://myles-bartlett.github.io/live-idea-wall/ (GitHub Pages from `main`, root).
- Every CSS/JS link in the HTML ends in `?v=N`. Raise N on every release so screens don't mix
  old and new files (Pages lets browsers cache for 10 minutes).
- Follow-up emails live in the `followups` table, readable only by facilitators, never on the
  public `ideas` table. Facilitator stacking uses `stack_id`; `parent_id` means a reply.

## Rules
- Never commit secrets. Only the Supabase Project URL and the **publishable / anon** key may live
  in `config.js` (they are designed to be public; Row Level Security protects the data).
  The **secret / service_role** key must never appear in this repo.
- Security lives in the database (RLS + the `support_idea` function), not in the front end.
- Must work in Microsoft Edge on a Surface Hub (touch, ~1920x1080 or 4K landscape) and on
  phones in Safari/Chrome. Never let a wall column scroll; cap and show "+N more".
- Keep accessibility: AA contrast on notes, area label on every note (not colour alone),
  large touch targets, respects reduced motion.
- Prefer small, reviewable commits with plain-English messages. Ask Myles before deleting files
  from `early test/` or making structural changes he hasn't seen.
- Explain things to Myles in plain language; he is not a full-time developer.
