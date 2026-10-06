// ── USERS & PERMISSIONS (v6.79.0, F-5) ───────────────────────────────────────
// Owner ruling (2 Sept 2026): each user sees only the modules ticked for them;
// Finance P/L and client analysis are visible to the OWNER only.
//
// On localStorage this is a CONVENIENCE gate — anyone technical can flip a flag
// in the browser. It is designed now because on Supabase the very same table
// becomes row-level security enforced by the database, and the DDL needs the
// shape: users(id, name, is_owner) + module permissions + finance permissions.
//
// Backward compatible: with NO users defined, everyone sees everything (today's
// behaviour). The first user marked owner is the gate that turns the model on.

export const MODULE_KEYS = ["dashboard", "pos", "lots", "orders", "shipments", "loadplans", "invoices", "claims", "finance", "contacts", "audit", "settings"] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
export const FINANCE_KEYS = ["ledger", "bank", "costs", "warehouse", "pl", "clients", "budget"] as const;
export type FinanceKey = typeof FINANCE_KEYS[number];

/** The two areas the owner reserved for himself by default. */
const OWNER_ONLY_FINANCE: FinanceKey[] = ["pl", "clients", "budget"];

export interface AppUser {
  id: any;
  name: string;
  role: string;                       // display only (General Manager, Operations, …)
  email?: string;                     // v7.1.0: the sign-in e-mail that identifies this person on the shared copy
  isOwner: boolean;
  modules: Record<string, boolean>;   // MODULE_KEYS → may open
  finance: Record<string, boolean>;   // FINANCE_KEYS → may open (within Finance)
}

/** v6.89.0: the WAREHOUSE preset — sees Inventory only (receipts, inspections, sorting, counts). */
export function warehouseUser(id: any, name: string): AppUser {
  const u = blankUser(id, name, false);
  MODULE_KEYS.forEach(k => { u.modules[k] = k === "lots" || k === "dashboard" || k === "contacts"; });   // v6.99.11 (owner): may add places in the Directory
  FINANCE_KEYS.forEach(k => { u.finance[k] = false; });
  u.role = "Warehouse";
  return u;
}
export function blankUser(id: any, name: string, isOwner = false): AppUser {
  const modules: Record<string, boolean> = {};
  MODULE_KEYS.forEach(k => { modules[k] = true; });
  const finance: Record<string, boolean> = {};
  FINANCE_KEYS.forEach(k => { finance[k] = isOwner || !OWNER_ONLY_FINANCE.includes(k); });
  return { id, name: String(name || "").trim(), role: isOwner ? "Owner" : "Operations", isOwner, modules, finance };
}

/** Resolve the current user by name. null = model not switched on (no users). */
export function currentUser(users: AppUser[], userName: any): AppUser | null | undefined {
  if (!(users || []).length) return null;
  const key = String(userName || "").trim().toLowerCase();
  return (users || []).find(u => String(u.name || "").trim().toLowerCase() === key);
}
/** v7.1.0 (A-USR-1, owner 6 Oct): in shared mode the SIGNED-IN E-MAIL picks the person — nobody types or chooses a name. */
export function userBySignIn(users: AppUser[], email: any): AppUser | undefined {
  const key = String(email || "").trim().toLowerCase(); if (!key) return undefined;
  return (users || []).find(u => String((u as any).email || "").trim().toLowerCase() === key);
}
/** The name the app works under: in shared mode the signed-in person's entry (or a marker nobody matches), otherwise the typed name. */
export function effectiveUserName(users: AppUser[], typedName: any, signInEmail: any): string {
  if (!signInEmail) return String(typedName || "");
  // v7.1.10 (owner 6 Oct, locked out right after deploying v7.1.9 — my sequencing fault: no entry could carry an e-mail before the field
  // existed): while NO entry in the Users list carries a sign-in e-mail yet, the typed name still applies, so the owner can open Settings
  // and fill the e-mails in; from the first e-mail on, the sign-in decides.
  if (!(users || []).some(u => String((u as any).email || "").trim())) return String(typedName || "");
  const u = userBySignIn(users, signInEmail);
  return u ? String(u.name || "") : `\u2205 ${String(signInEmail)}`;   // a name nobody in the list carries → Dashboard only
}
/** True while the Users list has no sign-in e-mail at all — the top bar then asks the owner to fill them in. */
export function signInNotLinkedYet(users: AppUser[]): boolean { return (users || []).length > 0 && !(users || []).some(u => String((u as any).email || "").trim()); }

/** May this user open the module? Owner: always. No users defined: always.
 *  Defined users but no match: only the dashboard — visible and explainable. */
export function canOpenModule(users: AppUser[], userName: any, moduleKey: string): boolean {
  const u = currentUser(users, userName);
  if (u === null) return true;
  if (!u) return moduleKey === "dashboard";
  if (u.isOwner) return true;
  return u.modules?.[moduleKey] !== false;
}

export function canOpenFinance(users: AppUser[], userName: any, financeKey: string): boolean {
  const u = currentUser(users, userName);
  if (u === null) return !OWNER_ONLY_FINANCE.includes(financeKey as FinanceKey) || true; // model off → today's behaviour
  if (!u) return false;
  if (u.isOwner) return true;
  return u.finance?.[financeKey] === true;
}

/** Exactly one owner is required once the model is on. */
export function usersGaps(users: AppUser[]): string[] {
  const gaps: string[] = [];
  if (!(users || []).length) return gaps;
  const owners = (users || []).filter(u => u.isOwner);
  if (!owners.length) gaps.push("No owner defined — someone must hold every permission or the owner-only areas become unreachable.");
  if (owners.length > 1) gaps.push(`${owners.length} owners defined — the owner-only areas are meant for one person.`);
  const names = new Set<string>();
  (users || []).forEach(u => { const k = String(u.name || "").trim().toLowerCase(); if (names.has(k)) gaps.push(`Duplicate user name "${u.name}".`); names.add(k); });
  return gaps;
}
