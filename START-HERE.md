# Start here (for Myles)

About 30–40 minutes end to end. Do the steps in order.

## 1. Make the project folder (5 min)
1. Create a folder **outside iCloud**, e.g. `~/Projects/live-idea-wall`
   (Finder > Go > Home, make `Projects`). iCloud Desktop files can be cloud-only and fail to load.
2. Unzip this package into it, so `CLAUDE.md` sits at the top level.
3. Copy your `EARLY TEST` folder in beside it. You should have:
   ```
   live-idea-wall/
     CLAUDE.md
     START-HERE.md
     EARLY TEST/
     docs/  reference/  supabase/
     config.example.js  .gitignore
   ```

## 2. Set up Supabase, the database (10 min)
1. Go to supabase.com, sign up (your Sheridan email is fine), **New project**.
   - Name: `live-idea-wall`. Set a strong database password and save it in your password manager.
   - Region: **Canada (Central)**, so the data stays in Canada (useful for the IT privacy chat).
2. When it finishes, open **SQL Editor > New query**, paste all of `supabase/schema.sql`, click **Run**.
3. **Authentication > Sign In / Providers**: keep Email on, turn **off** "Allow new users to sign up"
   (only you add facilitators).
4. **Authentication > Users > Add user > Create new user**: your email + a password, tick auto-confirm.
   Then in SQL Editor run the facilitator insert at the bottom of `schema.sql` with your email.
5. **Project Settings > API Keys**: copy the **Project URL** and the **publishable** key
   (older projects call it "anon public"). Duplicate `config.example.js` as `config.js` and paste them in.
   Do not copy the secret / service_role key anywhere.

Note: free Supabase projects pause after about a week with no activity. Open the site (or the
dashboard) during the week before the summit, and check it's awake the morning of day one.

## 3. Connect your computer to GitHub (10 min, one time)
Claude Code uses the normal `git` and GitHub tools on your Mac, so once your Mac is signed in,
Claude Code can create the repo, commit and push for you.
1. Open **Terminal** and run `git --version`. If macOS offers to install developer tools, accept.
2. Install the GitHub command-line tool: download the macOS installer from **cli.github.com**
   (or `brew install gh` if you use Homebrew).
3. Run `gh auth login` and choose: GitHub.com > HTTPS > Yes (authenticate Git) > Login with a web
   browser. Sign in with your **school GitHub account** in the browser and paste the code shown.
4. Check with `gh auth status`. You should see your school account.

If your school account belongs to a Sheridan GitHub organisation, ask whoever administers it
whether GitHub Pages is allowed for public sites. Putting the repo in a Sheridan-owned org (rather
than a personal account) makes it easier for the student team to take over later.

## 4. Hand it to Claude Code
Open Claude Code, choose the `live-idea-wall` folder, and paste this as your first message:

> Read CLAUDE.md and docs/HANDOFF-BRIEF.md. Then do Step 0 in the brief: study `EARLY TEST/`
> and `reference/hub-edition.html`, summarise what you find in plain language, and propose a plan
> and file structure. Don't change any files until I approve the plan. Once I approve, start by
> setting up git: initialise the repo, make a first commit of the current files, and create a
> GitHub repository called `live-idea-wall` with `gh`, then push.

Then work in small rounds: approve the plan, let it build the submit flow first, test on your
phone, then the facilitator features.

## 5. Turn on the public website
After the first push, in the repo on github.com: **Settings > Pages > Build and deployment >
Deploy from a branch > `main` / `(root)` > Save**. In a minute or two the site is live at
`https://<your-username-or-org>.github.io/live-idea-wall/` (phones use `…/live-idea-wall/#add`).
Every time Claude Code pushes, the site updates.

## Before the summit
- Quick conversation with Sheridan IT about storing delegates' ideas (and optional names) in
  Supabase, region Canada.
- Rehearse on the actual Surface Hub in Edge, plus a phone on venue-style Wi-Fi and a hotspot.
- Delete sample ideas, seed 12–18 real ones from Sheridan people, print the QR code.
