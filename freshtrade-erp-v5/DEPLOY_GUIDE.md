# Deploying MARIANNA ERP for your team to test

This walks you through publishing the app online so your 3–5 colleagues can use it from their own browsers. No installation needed for them — they just open a URL.

**Time:** ~45 minutes the first time, including account setup. After that, future updates take 2 minutes.

**Cost:** Free.

**Result:** A URL like `https://marianna-erp.vercel.app` that your colleagues can bookmark and use any time.

---

## Why this setup

We're using two free services:

- **GitHub** — stores your code online. Standard tool used everywhere in software. Think of it as Google Drive for code.
- **Vercel** — turns your code into a live website. Watches your GitHub repo and rebuilds the site automatically every time you change something.

Workflow once set up:
1. You make a change to a `.tsx` file on your computer
2. You push the change to GitHub (one command)
3. Vercel detects it within 30 seconds and rebuilds
4. Your colleagues see the update next time they refresh

---

## Part 1 — Create a GitHub account (10 min)

1. Go to **https://github.com**
2. Click **Sign up** (top right)
3. Enter your email — use one you check regularly (e.g. your Marianna email)
4. Choose a username — this will appear in your repo URL. Suggestions: `hazem-marianna`, `marianna-erp`, `mariannaeu`. Lowercase, hyphens OK, no spaces. **Pick something professional** — you can't easily change it later.
5. Pick a strong password
6. Verify the email (check your inbox)
7. Skip any "tell us about yourself" survey — click skip / continue
8. Pick the **Free** plan when asked

**You now have a GitHub account.** You don't need to install anything yet.

---

## Part 2 — Install GitHub Desktop (5 min)

GitHub Desktop is a free app that handles all the technical Git commands for you with a friendly interface. You'll use it to upload your project to GitHub.

1. Go to **https://desktop.github.com**
2. Click **Download for Windows**
3. Run the installer (no admin needed)
4. When it opens, click **Sign in to GitHub.com** → it'll open your browser → click Authorize → it links your account
5. When asked to configure Git, just click **Continue** with the defaults
6. Choose **"Let me configure my repo"** rather than auto-clone

Leave it open. We'll come back in a minute.

---

## Part 3 — Create the repository (5 min)

A "repository" (repo) is just a folder of code stored on GitHub.

1. In GitHub Desktop, click **File → New repository**
2. Fill in:
   - **Name**: `marianna-erp`
   - **Description**: `FreshTrade ERP for Marianna`
   - **Local path**: pick somewhere like `C:\Users\<your-name>\Documents` — GitHub Desktop will create a `marianna-erp` subfolder there
   - **Initialize this repository with a README**: ✅ check
   - **Git ignore**: choose `Node` from the dropdown — this prevents the huge `node_modules` folder from being uploaded
   - **License**: leave as "None"
3. Click **Create repository**

GitHub Desktop now has an empty repo on your machine. We need to put the V3 code into it.

---

## Part 4 — Copy V3 files into the repo (3 min)

1. Open the V3 folder I gave you: `freshtrade-erp-v3/`
2. Open the new repo folder GitHub Desktop made: `C:\Users\<your-name>\Documents\marianna-erp\`
3. **Copy these from V3 → into the repo folder:**
   - `package.json`
   - `tsconfig.json`
   - The entire `public\` folder
   - The entire `src\` folder
4. **Don't copy** the `standalone\` folder, the `.md` files (you can copy them if you want — they don't hurt), or `node_modules\` (it shouldn't exist yet)

The repo folder should now look like:
```
marianna-erp\
├── .gitignore           (created by GitHub Desktop)
├── README.md            (created by GitHub Desktop)
├── package.json
├── tsconfig.json
├── public\
│   └── index.html
└── src\
    ├── App.tsx
    ├── Dashboard.tsx
    ├── Contacts.tsx
    ├── PurchaseOrders.tsx
    ├── Inventory.tsx
    ├── SalesOrders.tsx
    ├── Settings.tsx
    ├── Shipments.tsx
    ├── shell_seed.ts
    ├── useLocalStoredState.ts
    └── index.tsx
```

5. Switch back to GitHub Desktop. It should now show all the new files in the left panel (the "Changes" list).
6. At the bottom-left, write a **summary**: `Initial V3 commit — full app with localStorage`
7. Click the blue **Commit to main** button
8. At the top, click **Publish repository**
9. In the popup: **uncheck "Keep this code private"** if you want me to be able to see it OR keep it checked if you want it private (Vercel works with either) — for now **keep it private**
10. Click **Publish repository**

The code is now on GitHub.

You can verify by going to `https://github.com/<your-username>/marianna-erp` in your browser — you should see all your files listed.

---

## Part 5 — Create a Vercel account (3 min)

1. Go to **https://vercel.com**
2. Click **Sign up**
3. Choose **Continue with GitHub** — this links the two services automatically
4. Authorize Vercel to access your GitHub account when prompted
5. When asked for a team name, just enter your name or `marianna` — it doesn't matter much
6. Pick the **Hobby** plan (free, no card needed)

---

## Part 6 — Deploy! (5 min)

1. From the Vercel dashboard, click **Add New… → Project**
2. You'll see a list of your GitHub repositories. Find **marianna-erp** and click **Import**
3. Vercel auto-detects it as a Create React App project. The defaults are correct:
   - Framework Preset: **Create React App**
   - Build Command: `npm run build` (default)
   - Output Directory: `build` (default)
   - Install Command: `npm install` (default)
4. **Skip environment variables** — we don't need any
5. Click **Deploy**

Wait 2–3 minutes. You'll see a build log scrolling by. When it's done:

✅ You'll see "Congratulations! Your project has been successfully deployed" with a URL like `https://marianna-erp-xxxx.vercel.app` and a screenshot of your app.

Click the URL — your app is live!

---

## Part 7 — Get a memorable URL (2 min)

The default URL has random characters. Let's clean it up.

1. In Vercel, go to your project → **Settings → Domains**
2. Under "Add Domain", type something like `marianna-erp` and hit Add
3. Vercel offers `marianna-erp.vercel.app` (if available)
4. Click **Add** to register it

If `marianna-erp.vercel.app` is taken, try `marianna-erp-test`, `marianna-fresh`, etc.

**This is the URL you share with your team.**

---

## Part 8 — Share with your team

Email your colleagues:

> Hi,
>
> I've put together a prototype of our new ERP system. I'd love your feedback over the next 2 weeks.
>
> **Try it here:** https://marianna-erp.vercel.app
>
> **What to do:**
> - Open the link in Chrome, Edge, or Firefox (Safari also works)
> - Click around, try entering some real-feeling test data — your own past orders, regular suppliers/clients
> - Your data stays in your browser only, so you can come back any time and it'll still be there
> - If you find anything weird, take a screenshot
>
> **Things I'd love your thoughts on:**
> - Does the navigation make sense?
> - Are the forms set up the way you'd actually fill them in?
> - Anything missing that we use every day?
> - Anything that just doesn't fit how we work?
>
> When you want to share your test data with me or with each other, go to **Settings → Export all data as JSON**. Email me the file and I can see exactly what you did.
>
> To reset to demo data: **Settings → Reset to demo data**.
>
> Thanks!
> Hazem

---

## Day-to-day workflow once it's live

**To update the app:**
1. Edit `.tsx` files on your computer using your editor
2. Open GitHub Desktop — it shows what you changed
3. Write a summary (e.g. "Fixed bug in SO form")
4. Click **Commit to main**
5. Click **Push origin** at the top
6. Within 30 seconds, Vercel rebuilds and your colleagues see the update on next refresh

**Important:** every update wipes nothing on your colleagues' end. Their localStorage data stays. So you can fix bugs and push updates while they're testing — nothing they entered is lost.

**Exception:** if you change the data schema (e.g. rename a field that's stored), bump `STORAGE_VERSION` in `useLocalStoredState.ts` from 1 to 2. Their old data will be ignored and they'll see fresh demo data. (Important: tell them to export first if there's anything worth keeping.)

---

## Collecting feedback

A practical pattern for 3–5 testers:

**1. Create a feedback Google Doc / Sheet** — one row per piece of feedback:
- Who reported it
- Module (PO / SO / Inventory / Shipments / etc.)
- What happened vs. what they expected
- Severity (blocker / nice-to-have / cosmetic)
- Status (new / in progress / fixed / wontfix)

**2. Weekly 30-min sync** — quickly walk through new feedback, decide which items go into next round

**3. When you fix something, push it the same day** so testers see action and stay engaged. Nothing kills test enthusiasm like "I reported that 3 weeks ago and nothing changed."

**4. Use the export feature** — if someone says "this doesn't work", ask them to Settings → Export and email you the JSON. Import it on your machine and you'll see exactly what they see.

---

## Costs & limits to know

- **Vercel Hobby plan**: free, unlimited deploys, 100GB bandwidth/month. You'll use a tiny fraction of that for 5 testers.
- **GitHub Free**: free, unlimited private repos. Plenty.
- **No hidden costs.** You won't be charged unless you actively upgrade.

---

## When you outgrow this

You'll know it's time for the real backend (Phase 2 — Node.js + PostgreSQL) when:

- Two testers want to see each other's data
- You want a single source of truth instead of per-browser data
- You need login / permissions / audit trail
- You're getting close to going into production
- Someone wants to use it from their phone *and* their desktop with the same data

When that happens, we'll discuss either Railway (~$5/month) or self-hosting. The frontend code stays largely the same — we just replace `useLocalStoredState` with calls to a real API.

For now, this setup gets you 4–8 weeks of valuable feedback for €0.

---

## If you get stuck

Common issues:

**Build fails on Vercel with TypeScript errors** → the local code probably has a typo we missed. Look at the error in the Vercel build log, fix the file, commit, push.

**GitHub Desktop won't sign in** → close it completely, restart Chrome/Edge, try again. Sometimes the OAuth flow gets stuck.

**Colleagues say the page is blank** → check whether they have JavaScript enabled (usually yes), check the URL is correct, ask for a screenshot of the browser console (F12 → Console tab).

**You want to make the repo public so you can show it off** → Vercel project settings → "Project Visibility" stays separate from repo visibility. Both can be private.

When something breaks: paste the error message into our chat and I'll help debug.
