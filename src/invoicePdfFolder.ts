// invoicePdfFolder.ts — v7.26.6 (A-INV-2, owner 17 Oct): THE INVOICE PDFs IN THE COMPANY'S DROPBOX FOLDER.
// The user chooses the folder once — the Dropbox folder on the computer; the browser writes the PDFs into it (as the backup folder
// does) and Dropbox syncs them, so an invoice can be read without opening Fakturownia. Chrome / Edge on a computer.
const DB = "marianna-invoice-pdfs", STORE = "folder", KEY = "handle";
const idb = (): Promise<IDBDatabase> => new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function getHandle(): Promise<any | null> { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch { return null; } }
async function putHandle(h: any): Promise<void> { const db = await idb(); await new Promise<void>((ok, no) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(h, KEY); tx.oncomplete = () => ok(); tx.onerror = () => no(tx.error); }); }
export function pdfFolderSupported(): boolean { return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function"; }
/** Choose (or change) the folder. */
export async function choosePdfFolder(): Promise<{ ok: boolean; name?: string; message?: string }> {
  if (!pdfFolderSupported()) return { ok: false, message: "This browser cannot write into a folder — use Chrome or Edge on a computer." };
  try { const h = await (window as any).showDirectoryPicker({ id: "marianna-invoice-pdfs", mode: "readwrite" }); await putHandle(h); return { ok: true, name: h.name }; }
  catch (e: any) { return { ok: false, message: e && e.name === "AbortError" ? "No folder chosen." : "The folder could not be opened." }; }
}
/** The chosen folder, ready to write (asks for the permission again if the browser dropped it); null when none is chosen. */
export async function pdfFolder(): Promise<any | null> {
  const h = await getHandle(); if (!h) return null;
  try { if ((await h.queryPermission({ mode: "readwrite" })) === "granted" || (await h.requestPermission({ mode: "readwrite" })) === "granted") return h; } catch { /* fall through */ }
  return null;
}
/** The file name: date_number_company.pdf — safe on every system. */
export function pdfFileName(inv: any): string {
  const clean = (v: any) => String(v ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${clean(String(inv?.issueDate || "").slice(0, 10)) || "undated"}_${clean(inv?.number) || "no-number"}_${clean(inv?.counterparty?.name) || "unknown"}`.slice(0, 150) + ".pdf";
}
/** Write one PDF into the folder (replacing a file of the same name). */
export async function savePdfToFolder(folder: any, name: string, blob: Blob): Promise<void> {
  const fh = await folder.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close();
}
