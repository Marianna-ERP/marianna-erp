// noteRequest.ts — v7.34.0 (CN-2, owner 26 Oct: "any credit / debit note should stay in one place, which is the Invoices module"):
// a module that needs a note does not write it — it REQUESTS one: Invoices opens its own note form, prefilled (the party by id, the invoice it
// corrects, the claim / sale / lot it came from), and the note is created there. The same pattern as a company requested from Parties.
export const NOTE_REQUEST_KEY = "marianna:newNote";
export function requestNoteInInvoices(prefill: any): void {
  try { window.sessionStorage.setItem(NOTE_REQUEST_KEY, JSON.stringify(prefill || {})); } catch { /* the form then opens empty */ }
  try { window.dispatchEvent(new CustomEvent("marianna:navigate", { detail: { module: "invoices" } })); } catch { /* no window */ }
}
/** Invoices: the request left by another module, read once. */
export function takeNoteRequest(): any | null {
  try { const r = window.sessionStorage.getItem(NOTE_REQUEST_KEY); window.sessionStorage.removeItem(NOTE_REQUEST_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
