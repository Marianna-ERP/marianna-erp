# v6.18.22 — Build hotfix (strict-mode type error in the v6.18.21 inventory filter)

## Fix
- **Vercel build failed on v6.18.21** with `TS2322: Type 'unknown' is not assignable to
  type 'Key'` at the Inventory product filter. The derived `productOptions` list resolved
  to `unknown[]` under CRA's strict build, so `<option key={p}>` was rejected. It's now an
  explicitly-typed `string[]` (built via a typed `Set<string>`), which compiles cleanly.
- No behaviour change — the filter still lists the products actually in stock.

## Verified
- Passes the type-check harness **and** a strict (`--strict`) pass on Inventory.tsx;
  all imports at file tops.

> Note: this class of error (JSX `key` typing under strict mode) isn't caught by the
> offline harness, which runs looser than CRA. Running `npm run build` locally before
> deploying catches it — worth doing on each release.
