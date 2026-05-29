# Vercel build fix — dynamic table header alignment

## Error fixed

Vercel failed during `CI=false npm run build` on a JSX style expression like:

```tsx
textAlign: h.align
```

React TypeScript types require `textAlign` to be a narrow CSS literal such as `"left"`, `"center"`, or `"right"`. In the mapped header arrays TypeScript inferred `h.align` as a generic `string`, so the production build failed even though the runtime UI was valid.

## Files patched

- `src/PurchaseOrders.tsx`
- `src/SalesOrders.tsx`

## Fix applied

The mapped header alignment is now narrowed before being passed into both the `style` object and the bilingual label component:

```tsx
const headerAlign = h.align as "left" | "center" | "right";
```

Then:

```tsx
textAlign: headerAlign
<BiLbl align={headerAlign} />
```

## Deploy note

Replace the two patched files, commit, and push. Vercel should then continue past this TypeScript error. If another error appears, paste the first red `Failed to compile` block.
