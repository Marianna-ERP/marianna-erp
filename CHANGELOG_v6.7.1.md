# v6.7.1 — Build hotfix (deploy THIS zip; it supersedes v6.4.1 → v6.7.0)

## Fixed
1. **Vercel build failure (TS2551)** in SalesOrders: the v6.4.1
   delivery-vs-PO-arrival fix accessed `po.expectedDeliveryDate`, but the
   standalone demo stub types its POs with the old `expectedDelivery` name,
   so TypeScript rejected the property. The lookup now tolerates both field
   names (live POs use `expectedDeliveryDate`; the stub keeps working in
   standalone mode).
2. Verification upgraded: every release is now checked with a **full
   TypeScript type-check replicating the Vercel/CRA build** (not just syntax
   parsing, which is what let this and the v6.5 Finance-annotation issue
   slip). Both known type errors are fixed; the whole codebase type-checks
   clean.

## Deployment note
This zip is cumulative — it contains everything from v6.4.1 (date-integrity
fixes), v6.5.0 (warehouse charges), v6.6.0 (consignment & settlement) and
v6.7.0 (Fakturownia cost bridge), plus this fix. Do NOT deploy the older zips
one by one; copy THIS file set into the repo root, commit, push once.
