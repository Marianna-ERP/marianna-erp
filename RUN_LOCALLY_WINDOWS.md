# Run on Windows — quick start

You can't use StackBlitz, so we'll install Node.js locally and run from the command line. This file walks you through it from scratch.

---

## 1. Install Node.js (one-time only)

Open `cmd` (Windows key → type `cmd` → Enter).

```
node --version
```

**If you see something like `v18.x.x` or `v20.x.x` or `v22.x.x`** → Node.js is installed, skip to step 2.

**If you see `'node' is not recognized…`** → download and install:

1. Go to **https://nodejs.org**
2. Click the green **LTS** button on the left (Long-Term Support version)
3. Run the downloaded `.msi` installer, click Next through everything
4. **Close all `cmd` windows** and open a fresh one
5. Type `node --version` again — it should show the version now

---

## 2. Put the project somewhere easy to find

Recommended location:

```
C:\Users\<your-name>\Documents\marianna-erp\
```

Inside that folder, copy **the contents** of this `freshtrade-erp-v2` folder. The structure should look like:

```
marianna-erp\
├── package.json
├── tsconfig.json
├── public\
│   └── index.html
├── src\
│   ├── App.tsx
│   ├── Dashboard.tsx
│   ├── Contacts.tsx
│   ├── PurchaseOrders.tsx
│   ├── Inventory.tsx
│   ├── SalesOrders.tsx
│   ├── Shipments.tsx
│   ├── shell_seed.ts
│   └── index.tsx
└── standalone\
    └── Shipments.tsx
```

(You can ignore the `.md` files for running — they're just documentation.)

---

## 3. Install dependencies (one-time per project)

In `cmd`, navigate into the folder:

```
cd C:\Users\<your-name>\Documents\marianna-erp
```

Then install:

```
npm install
```

This takes **2–5 minutes** and downloads everything React needs into a `node_modules\` folder. You'll see a lot of scrolling text — that's normal. Ignore `npm warn` lines. Only `npm err` matters. When finished, your prompt returns.

---

## 4. Start the app

```
npm start
```

Wait 10–30 seconds. You'll see:

```
Compiled successfully!

You can now view freshtrade-erp in the browser.

  Local:            http://localhost:3000
```

Your browser should open automatically to **http://localhost:3000**. If it doesn't, open Chrome/Edge/Firefox and go to that URL manually.

You should see the **MARIANNA ERP** top nav with 6 tabs:
**Dashboard · Purchase Orders · Inventory · Sales Orders · Shipments · Counterparties**

The Dashboard loads by default.

---

## 5. Working day-to-day

- **Edit any `.tsx` file in `src\`** → save → the browser auto-refreshes with your changes. Very nice for iteration.
- **Stop the server**: in the `cmd` window, press `Ctrl+C`, then `Y`
- **Restart later**:
  ```
  cd C:\Users\<your-name>\Documents\marianna-erp
  npm start
  ```
- **You don't need to run `npm install` again** unless `package.json` changes (e.g., after pulling new files from a future session)

---

## What to test first

Pick one of the **cross-module workflows** the V2 build introduces to verify everything works end-to-end:

### Test 1 — SO confirmation creates a live reservation
1. Open **Sales Orders** → **+ New SO**
2. Pick a client (e.g. Biedronka), add a line: **Papryka Kapia, 1000 kg**, source from **LOT-2026-0086**
3. Save with status **Confirmed**
4. Switch to **Inventory** → click **LOT-2026-0086**
5. ✅ You should see a new **RESERVATIONS** card showing the SO you just created, holding 1000 kg

### Test 2 — Cancellation reverses inventory
1. Open the SO you just made → change status to **Shipped** → Save
2. Open **Inventory** → **LOT-2026-0086** → confirm `physicalKg` dropped by 1000 kg
3. Go back to SO → change status to **Cancelled** → Save
4. ✅ Open the lot again → `physicalKg` restored, a **REVERSAL** movement appears in the timeline

### Test 3 — PO confirmation creates Expected lot
1. Open **Purchase Orders** → **+ New PO**
2. Add supplier, products with prices, save as **Confirmed**
3. ✅ Open **Inventory** → a new **Expected** lot appears, linked to the PO

### Test 4 — Shipments transport order
1. Open **Shipments** → click **SHP-2025-0107** (the seed scenario)
2. Click **Transport order** → preview the bilingual EN/PL printout with MARIANNA logo
3. ✅ Verify all loading/unloading details and the goods table render correctly

---

## Common issues

**"npm is not recognized"** → Node install didn't update PATH. Close all `cmd` windows, open a fresh one. If still broken, reboot.

**`npm install` error about Python / Visual Studio** → ignore it. The `xlsx` package sometimes tries to compile a native module on Windows and falls back fine. As long as install finishes, you're good.

**"Port 3000 is already in use"** → another app is on that port. When prompted, type `Y` and it'll use port 3001.

**Browser shows red error page** → check the `cmd` window for the actual error. Copy it and we can debug. Usually a typo from a recent edit.

**Page renders but Shipments tab is blank** → check the browser console (F12 → Console tab). Most likely a missing prop or a typo somewhere. Tell me what you see.

---

## Pulling future updates

When we make changes in our chats and I share new files:

1. **If only `.tsx` files changed**: just replace them in `src\`, save. Browser auto-refreshes.
2. **If `package.json` changed**: stop the server (Ctrl+C, Y), run `npm install`, then `npm start` again.
3. **Keep `standalone\` files in sync if you want to test isolated modules.**
