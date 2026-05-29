# Vercel build fix - Contacts import summary

## Problem

Vercel stopped on `src/Contacts.tsx` around the Fakturownia import review summary:

```tsx
Object.entries(countByType).map(([t, n]) => (
  <span key={t}><strong style={{ color: TYPE_COLORS[t]?.color || "#111" }}>{n}</strong> {t}</span>
))
```

Depending on the TypeScript version used during the production build, `Object.entries(countByType)` can infer `n` as `unknown`, and `TYPE_COLORS[t]` can be treated as indexing a narrow object with a generic string key. That makes the JSX invalid for production compilation.

## Fix applied

In `src/Contacts.tsx`:

- `TYPE_COLORS` is now typed as `Record<string, { bg: string; color: string }>`.
- `SERVICE_COLORS` is now typed as `Record<string, { bg: string; color: string; icon: string }>`.
- `parsedRows` is now `useState<any[]>([])` instead of an untyped empty array.
- `countByType` is now explicitly `Record<string, number>`.
- `COUNTRY_TYPE_RULES` is now typed as `Record<string, string>`.

Proactive safety typing was also added to dynamic lookup maps in:

- `src/Inventory.tsx`
- `src/PurchaseOrders.tsx`
- `src/SalesOrders.tsx`
- `src/Shipments.tsx`

This avoids the same class of Vercel build error appearing later in another module.

## Validation

A TypeScript `noEmit` check was run in this environment using temporary local shims for React/XLSX because `node_modules` are not available here. The check passed with zero TypeScript errors. The shim file was removed before packaging.

Run on Vercel with the included `vercel.json`:

```json
{
  "buildCommand": "CI=false npm run build",
  "outputDirectory": "build",
  "framework": "create-react-app"
}
```
