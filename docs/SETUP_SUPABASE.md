# Set up your own Supabase project

One teammate does this once. Everyone else just signs in. `/setup` walks you through it; this page is the reference.

## 1. Create the project

1. Go to supabase.com and sign in. Decide whose account owns the project: the free tier allows only two active projects per organization, so a shared team account is often best.
2. Create a new project. Pick a region near you and save the database password in your password manager, not in the repo.
3. From **Project Settings, API**, note the project URL and the publishable (anon) key. Both are safe to commit. The service role key is secret: never commit it or paste it into chat.

## 2. Turn on Google sign-in

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add the redirect URL Supabase shows under **Authentication, Providers, Google** to the client's authorized redirect URIs.
3. Paste the client ID and secret into the Google provider in Supabase and enable it.
4. Under **Authentication, URL Configuration**, set the site URL to where your app will live, and add `http://localhost:5173` for local work.

Sign-ups are closed by the database: only addresses on your team's allow list can get in. Nobody needs a password.

## 3. Load the schema and your team

1. Run the migrations in `app/supabase/migrations/` against your project (the setup skill does this with the Supabase CLI).
2. Fill in `team.json` with your members' handles, names and ID prefixes.
3. Run `python3 scripts/team.py sql` and run what it prints in the Supabase SQL editor. It loads your members and categories.

## 4. Point the repo at it

Write `hub.json` at the repo root with your project URL, publishable key and app address. Commit it. Then each teammate runs:

```bash
python3 scripts/hub.py login
```

It opens Google in the browser. Pick your own account. `python3 scripts/hub.py whoami` then prints your handle.

## What never goes in the repo

The service role key, the database password, and the Google client secret. If one leaks, rotate it in Supabase or Google right away.
