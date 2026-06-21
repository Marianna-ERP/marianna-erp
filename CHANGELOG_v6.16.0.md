# v6.16.0 — Shipment creation, leg naming, transport email, Finance & Fakturownia fixes

> Transpile/syntax-checked only — run `npm install && npm run build` locally before deploying.

## PO / SO
- **Clearer "Clear" control (#1).** On a Sales Order line, the faint grey "Clear"
  (remove source link) is now a visible red **"✕ Clear source"** button. (PO line
  rows already use a clear red 🗑 to remove a line.)

## Create shipment
- **No accidental duplicate for a fully-shipped PO (#2).** When you pick a PO that
  already has shipment(s), a banner shows how much is already shipped and how much
  remains. If the PO looks **fully shipped** (all kg on shipments, or Arrived/Closed),
  the Create button is disabled until you tick **"Create anyway"** — so you don't
  duplicate a shipment for goods that are no longer in our warehouse.
- **Sea mode no longer behaves like Multimodal (#3).** Selecting **Sea** now shows a
  single **sea forwarder / line** + freight, instead of the road-carrier + sea-forwarder
  pair that Multimodal uses.
- **Dates renamed and sourced correctly (#4).** The header dates are now **Expected
  loading date** and **Expected delivery date**. The loading date is prefilled from the
  **PO loading date** (start of the whole shipment) and the delivery date from the
  **SO delivery date** (end of the shipment). The in-between dates remain per-leg
  (truck arrival, container loading from port, etc.).

## Edit shipment
- **Leg "From / To" renamed to "Loading / Unloading" (#5)** in the leg editor and the
  read-only detail view, matching the transport order wording.

## Transport order email
- **Multimodal now addresses the right provider (#6).** Switching the provider in the
  email dialog rebuilds the message so it addresses the chosen **carrier or forwarder**
  and its own leg — it no longer always refers to the carrier.
- **Freight shown in the leg currency (#7).** The freight figure in the email body now
  uses the currency chosen for that provider's leg (e.g. USD/EUR), not the PLN default;
  mixed currencies are listed per currency.

## Finance
- **Operational costs layout swapped (#8).** The **cost entries register** is now on the
  left (wider) and the **add / edit operational cost** form on the right.

## Fakturownia import
- **Invoice number now captured (#9).** The cost-register export has several "Numer …"
  columns (accounting no., position no., order no.); the importer was grabbing the wrong
  one and leaving the invoice number blank. It now prefers the genuine invoice-number
  header and skips the lookalikes, so the number comes in automatically. (You can still
  edit it in the preview before importing.)

## Please verify when testing
- Create a shipment from a PO that's already shipped — confirm the warning/gate appears.
- Pick Sea vs Multimodal and confirm Sea shows a single sea provider.
- Open the transport-order email on a multimodal shipment, switch provider, and check the
  greeting and freight currency follow the selection.
- Import a Fakturownia cost CSV and confirm the invoice numbers come through.
