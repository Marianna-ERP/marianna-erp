# HOW TO DEPLOY — read this once, then it's always the same

This file exists to end the "send everything to ChatGPT to batch it" round-trip.
The zip you downloaded is **already** GitHub + Vercel ready. No batching needed.
Follow these steps exactly and it will deploy every time.

---

## The one rule that matters most

**`package.json` must sit at the TOP of your GitHub repo — not inside a subfolder.**

99% of failed deploys are because the files ended up one level too deep, like this:

```
your-repo/
└── marianna-erp-v6/          ← WRONG: everything is nested
    ├── package.json
    ├── src/
    └── public/
```

It must look like this:

```
your-repo/
├── package.json              ← RIGHT: at the top level
├── vercel.json
├── tsconfig.json
├── .npmrc
├── public/
│   └── index.html
└── src/
    ├── App.tsx
    └── ...
```

---

## Step-by-step (do this every release)

### 1. Unzip
Unzip the file I gave you. You'll get a folder. **Open it.** Inside you'll see
`package.json`, `src/`, `public/`, `vercel.json`, etc. — these are the files
that need to go into your repo. NOT the folder itself — the files INSIDE it.

### 2. Copy the files into your repo folder
Open your local GitHub repo folder (the one GitHub Desktop manages) in a second window.

- Select ALL the files from inside the unzipped folder (package.json, src, public,
  vercel.json, tsconfig.json, .npmrc, README.md)
- Copy them
- Paste into your repo folder, choosing "Replace" / "Merge" when asked

After this, your repo folder should have `package.json` sitting right at the top,
next to `src/` and `public/`.

### 3. Commit & push in GitHub Desktop
- GitHub Desktop shows the changed files on the left
- Write a short summary (e.g. "v6 update")
- Click **Commit to main**
- Click **Push origin**

### 4. Vercel deploys automatically
Vercel watches your repo. ~30–60 seconds after the push it rebuilds.
Watch the deploy log at vercel.com → your project → Deployments.

---

## One-time Vercel settings (set these ONCE, never touch again)

Go to vercel.com → your project → Settings → Build & Development Settings:

| Setting | Value |
|---|---|
| Framework Preset | **Create React App** |
| Build Command | leave default (vercel.json overrides it to `CI=false npm run build`) |
| Output Directory | `build` |
| Install Command | leave blank (auto `npm install`) |
| **Root Directory** | leave BLANK if files are at repo root. If you insist on keeping them in a subfolder, type that folder's name here. |
| Node.js Version | 24.x (also pinned in package.json) |

Settings → General → Node.js Version → **24.x**.

---

## Why this zip already works (so you don't doubt it)

This package includes the three things that previously caused build failures —
they are now baked in, so you never need ChatGPT to add them again:

1. **`vercel.json`** with `"buildCommand": "CI=false npm run build"`.
   Without `CI=false`, Vercel treats harmless warnings (unused variables etc.)
   as fatal errors and the build dies. This file fixes that permanently.

2. **`package.json`** with `"engines": { "node": "24.x" }` — pins the Node version.

3. **`.npmrc`** — quiets npm noise that can confuse the build log.

All of these travel WITH the zip. As long as you copy the whole file set
(including the dot-file `.npmrc` — make sure hidden files are shown!), it deploys.

---

## If a deploy fails — the 3 things to check, in order

1. **Is `package.json` at the repo root?** (Step 1 rule above.) → Most common.
2. **Did `.npmrc` and `vercel.json` get copied?** They're easy to miss because
   `.npmrc` starts with a dot and may be hidden. Turn on "show hidden files".
3. **Read the FIRST error in the Vercel log** (not the last). Copy that line
   and send it to me. The first error is the real cause; everything after is noise.

---

## What you send me / what I send you — the new normal

- **You → me:** the latest working zip (like `marianna_erp_v5_8_integrity.zip`).
  Always the zip, never loose files — loose files get mixed up between laptops.
- **Me → you:** a complete, root-correct, deployable zip every time.
  You unzip, copy files into the repo, commit, push. Done.

No ChatGPT batching step. If something in my zip doesn't deploy, that's my bug
to fix, and the first error line from Vercel tells me exactly what.
