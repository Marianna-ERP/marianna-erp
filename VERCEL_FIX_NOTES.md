# Vercel deployment fix notes

The Vercel log that starts with `npm warn deprecated ...` is not the actual build error. Those lines are install warnings produced by old dependencies inside `react-scripts`. They do not stop deployment by themselves.

This package includes a Vercel-focused deployment adjustment:

- `package.json` includes `engines.node = 20.x` so Vercel builds with Node 20, a safer LTS target for the current Create React App / react-scripts setup.
- `vercel.json` sets `buildCommand` to `CI=false npm run build`. Create React App treats warnings as build-failing errors when `CI=true`; Vercel sets CI automatically. This avoids false deployment failures caused by warnings while keeping real TypeScript/runtime errors fatal.
- `Finance.tsx` and `Settings.tsx` were patched for TypeScript/JSX compatibility in Vercel builds.

Recommended Vercel settings:

- Framework Preset: Create React App
- Install Command: npm install
- Build Command: CI=false npm run build
- Output Directory: build
- Node.js Version: 20.x

If a deployment still fails, scroll below the deprecated warnings and copy the first red block after `npm run build`, usually under `Failed to compile`.

- `.npmrc` reduces noisy npm install output by hiding non-fatal warnings while still showing real errors.
