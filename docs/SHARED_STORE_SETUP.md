# MARIANNA — turning on the shared data (one copy for everyone)

*v6.99.149. The app keeps working on each browser alone until the steps below are done; then it switches by itself. Read Step 4 before anyone signs in.*

## Step 1 — the two settings in Vercel (done on 5 Oct)
Project **marianna-erp** → Settings → Environments → Production → Environment Variables:
- `REACT_APP_SUPABASE_URL` = the Project URL (`https://<project id>.supabase.co`)
- `REACT_APP_SUPABASE_ANON_KEY` = the anon / publishable key

Both as **Config** (the app runs in the browser, so it must see them; the anon key is the public key by design).

## Step 2 — the table and its rules, in Supabase
Supabase → left menu **SQL Editor** → **New query** → paste everything below → **Run**.

```sql
-- one row per store (contacts, pos, lots, orders, shipments …), with a version for conflict detection
create table if not exists public.stores (
  key text primary key,
  data jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.stores enable row level security;

-- only a signed-in Marianna user may read or write; nobody else can see anything
drop policy if exists "marianna read" on public.stores;
drop policy if exists "marianna insert" on public.stores;
drop policy if exists "marianna update" on public.stores;
create policy "marianna read"   on public.stores for select to authenticated using (true);
create policy "marianna insert" on public.stores for insert to authenticated with check (true);
create policy "marianna update" on public.stores for update to authenticated using (true) with check (true);
```

It should say "Success. No rows returned".

## Step 3 — the three users
Supabase → left menu **Authentication** → **Users** → **Add user** → *Create new user*: e-mail + password, tick **Auto Confirm User**. One for each of you.
Then **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up", so nobody can create an account by themselves.

## Step 4 — the REAL start (production: marianna-erp.vercel.app)
**The upload must come from the browser that holds the real data — your colleague's, not the test browser.** When anyone signs in, the shared copy replaces that browser's data (a snapshot of the browser's own data is kept first, but don't rely on it).
1. Your colleague exports her data once as a safety copy: **Settings → Export all data**.
2. Push v6.99.149 to `main`; Vercel builds the production site with the two Production settings.
3. **Your colleague signs in FIRST**, on her browser. The top bar shows *shared store is empty* and the button **Upload this browser's data as the shared data**. She presses it; a confirmation names what goes up ("45 POs, 29 sales orders, 124 lots…") — she checks the numbers are hers and confirms.
4. Only then do the others sign in. Their browsers take the shared data.
**Until step 3 is done, nobody signs in to the production address with a test browser.**

## Step 5 — the TEST copy (a separate address, separate data)
1. **Supabase:** create a second project, e.g. *Marianna TEST* (the free plan allows two). In it, run the same SQL as in Step 2 and add yourself as a user (Step 3). Copy its Project URL and anon / publishable key.
2. **Vercel → marianna-erp → Settings → Environments → Preview → Environment Variables:** add three, all as **Config**:
   - `REACT_APP_SUPABASE_URL` = the TEST project's URL
   - `REACT_APP_SUPABASE_ANON_KEY` = the TEST project's key
   - `REACT_APP_ENV_LABEL` = `TEST`
3. **GitHub:** create a branch called `test` (on the repository page: the branch menu → type `test` → *Create branch*). Push the same zip to it.
4. Vercel builds it as a **Preview** with its own fixed address, shown on the deployment (it looks like `marianna-erp-git-test-….vercel.app`). That address shows a purple **TEST DATA** strip across the top and *TEST* on the sign-in page; it reads and writes only the TEST project.
5. Sign in there, press *Upload this browser's data as the shared data* from your test browser — your test data becomes the test copy. Break things freely; the real copy never sees it.

From then on: work you want to try goes to `test` first; when it is right, the same zip goes to `main`.

## What the pill in the top bar means
- **shared · synced** — this tab and the shared copy agree.
- **shared · saving…** — a change is being written.
- **shared · offline** — the write failed (no internet, Supabase down); the change is kept in this browser and retried on the next save.
- **<store>: a colleague saved first** — two people changed the same store within seconds; their copy was taken, yours is kept as a *conflict copy* in this browser (Settings → Export shows it). Redo your change.

## What does NOT change
Backups, Export / Import and the auto-backup folder keep working exactly as before — they read this browser's copy, which is the shared copy once synced.
