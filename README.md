# Live Idea Wall

A live "digital sticky note" wall for Sheridan College's exhibit at the Colleges Ontario
Powering Growth Expo (2026 Higher Education Summit). Delegates answer one question:

> How might Ontario's colleges power growth over the next ten years?

Ideas land live on a Microsoft Surface Hub, colour-coded into six opportunity areas plus
"Something else". Delegates support ideas and build on them. Facilitators curate the wall and
switch it to a closing summary at the end.

- **Wall (Surface Hub):** https://myles-bartlett.github.io/live-idea-wall/
- **Phone form (the QR code target):** https://myles-bartlett.github.io/live-idea-wall/#add
- **Booth tablets:** https://myles-bartlett.github.io/live-idea-wall/#add?kiosk
- **Printable QR sign:** https://myles-bartlett.github.io/live-idea-wall/sign.html
- **Try it without touching real data:** https://myles-bartlett.github.io/live-idea-wall/?demo
  (also `?demo=400` for a crowded wall, `?demo&live` for a new sample idea every 8 seconds)

## How it works

A static website (plain HTML, CSS and JavaScript, no build step) hosted on **GitHub Pages**,
talking to **Supabase** (a hosted Postgres database with live updates and logins). Every screen
reads and writes the same database and updates within a second or two.

Security lives in the database, not the web page: Row Level Security rules in
[`supabase/schema.sql`](supabase/schema.sql) decide who can change what. The public can post ideas
and add support (one at a time, through the `support_idea` function). Only signed-in facilitators
can edit, hide, stack or delete. Follow-up emails sit in their own table that only facilitators
can read.

### Files

| File | What it does |
|---|---|
| `index.html` | The wall. `#add` redirects to `add.html`. |
| `add.html` | The phone and tablet form. `?kiosk` clears itself 20 s after each post. |
| `sign.html` | A printable QR sign for the booth. |
| `config.js` | The Supabase project address and **publishable** key (safe to be public). |
| `css/base.css` | Colours (from sheridancollege.ca), fonts, area colours. |
| `css/wall.css` | Wall layout, notes, pop-ups, facilitator mode, closing summary, phone layout. |
| `css/add.css` | The submit form. |
| `js/areas.js`, `js/feelings.js` | The seven areas and the eight feelings. Keys must match the database. |
| `js/db.js` | The one Supabase connection per page. |
| `js/store.js` | Loads every idea, listens for live changes, refetches every 60 s and on reconnect. |
| `js/stacks.js` | Groups near-duplicate ideas, replies and facilitator-made stacks. |
| `js/wall.js` | Draws the four views (Areas, Newest, Most supported, Latest), filters, the summary. |
| `js/detail.js` | Tapping a note: details, Support, Build on this idea, Find my idea. |
| `js/addform.js`, `js/add.js` | The form, its confirmation screen, kiosk behaviour. |
| `js/outbox.js` | The offline-safe queue: posts are saved on the device until Supabase has them. |
| `js/facilitator.js` | Sign-in, curation tools, drag-to-stack, the panel, export. |
| `js/samples.js` | The sample ideas used by demo mode and "Load sample ideas". |
| `supabase/` | The database setup and updates (see below). |
| `early test/` | The original prototype. Its look is the design source of truth. Leave it as is. |
| `reference/hub-edition.html` | An earlier rebuild used as a behaviour reference only. |

## Run it on your own computer

You need Python 3 (already on a Mac). In Terminal, from this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/ (the wall) or http://localhost:8000/add.html (the form).
It uses the real database, so add `?demo` to try things without changing real data.

Opening `index.html` straight from Finder (a `file://` address) will not work. Use the command above.

## Make a change and publish it

1. Edit the files and check them locally (above).
2. **Raise the version number.** In `index.html` and `add.html`, every CSS and script link ends in
   `?v=8` (or whatever it is now). Change every one to the next number, e.g. `?v=9`.
   Without this, screens can keep old copies for up to 10 minutes and look broken.
3. Commit and push to `main`:
   ```bash
   git add -A
   git commit -m "Say in plain English what changed"
   git push
   ```
4. GitHub Pages republishes within about a minute (repo > **Actions** shows progress).
   Reload any open screens.

## The database (Supabase)

Project: `live-idea-wall`, region Canada (Central). Sign in at supabase.com.

- **A brand-new project:** run [`supabase/schema.sql`](supabase/schema.sql) once in
  **SQL Editor > New query > Run**. That is all it needs.
- **The existing project** was set up before two later updates. Both have been run already.
  For the record: [`002-feeling-and-followups.sql`](supabase/002-feeling-and-followups.sql)
  (feelings and follow-up emails) and
  [`003-facilitator-stacks.sql`](supabase/003-facilitator-stacks.sql) (facilitator stacking).
  Both are safe to run again.
- **Keys:** only the Project URL and the **publishable** (anon) key belong in `config.js`.
  The **secret / service_role** key must never be in this repo or on any web page.
- **Free projects pause after about a week with no activity.** Open the wall during the week
  before the summit, and check it is awake on the morning of day one.

### Add a facilitator

1. Supabase > **Authentication > Users > Add user > Create new user**: their email and a
   password, tick **Auto Confirm User**.
2. **SQL Editor**, run (with their email):
   ```sql
   insert into public.facilitators (user_id, label)
   select id, email from auth.users
   where email in ('someone@sheridancollege.ca')
   on conflict (user_id) do nothing;
   ```
3. They sign in from the **gear** at the bottom right of the wall.

Keep **Authentication > Sign In / Providers > Allow new users to sign up** turned **off**, so
only you create accounts. To remove a facilitator, delete them under **Authentication > Users**.

## Facilitator guide (short version)

Sign in with the gear. A yellow strip shows you are in facilitator mode. It signs itself out
after 10 idle minutes; use **Sign out** when you step away from the Hub.

- **Tap a note:** edit its text and area, hide it, move it, split a stack apart.
- **Drag a note:** onto the middle of another note to stack them, or anywhere in a column to move
  it. A label under your finger says which will happen.
- **Facilitator panel:** closing synthesis, preview, the summary switch, rotating notes,
  the "Something else" column, hidden ideas (show again), sample ideas, and export.
- **Moderation rule:** hide personal attacks and identifiable complaints about individuals.
  Do not hide criticism of policy.
- **Export** downloads every idea as CSV (opens in Excel) or JSON, including feelings and
  follow-up emails. The emails are personal information: store the file carefully.

## Rehearsal vs the real event

**For a rehearsal:** sign in, open the panel, **Load sample ideas** (each is tagged "Sample").
Afterwards, **Remove all sample ideas**. Real ideas are not touched.

**Before the real event:** clear out every test and rehearsal idea:

1. Facilitator panel > **Download CSV** first, in case you want a record.
2. Supabase > **SQL Editor**, run [`supabase/reset-for-event.sql`](supabase/reset-for-event.sql).
   It deletes **every idea, support and follow-up email** and puts the settings back to the start.
   This cannot be undone.
3. Seed 12 to 18 real ideas from Sheridan people, using the phone form.
4. Set the rotating notes in the panel, print the QR sign, and do one test post on venue Wi-Fi.

## On the day

- **Surface Hub:** open the wall in Edge, press F11 for full screen. The view bar under the
  question switches views (keys 1 to 4), filters by area or feeling, and turns on Auto rotate.
- **Booth tablets:** open the `#add?kiosk` link.
- **Connection:** the footer says **Live**, **Reconnecting…** or **Offline**. Posts made while
  offline wait on the device and send when the connection returns.
- **Closing:** write the synthesis in the panel, **Preview on this screen only**, then
  **Show the closing summary on every screen**.

See [`docs/ACCEPTANCE-TESTS.md`](docs/ACCEPTANCE-TESTS.md) for what has been tested and what
still needs a real Surface Hub and iPhone.
