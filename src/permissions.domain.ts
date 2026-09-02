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
  isOwner: boolean;
  modules: Record<string, boolean>;   // MODULE_KEYS → may open
  finance: Record<string, boolean>;   // FINANCE_KEYS → may open (within Finance)
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
