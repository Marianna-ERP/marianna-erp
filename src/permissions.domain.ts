import { isSharedMode } from "./remoteStore";   // v7.1.15
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
  // v7.1.13: the v7.1.10 typed-name bootstrap is gone — an unlinked sign-in claims its entry from the top bar instead (one rule)
  const u = userBySignIn(users, signInEmail);
  return u ? String(u.name || "") : `\u2205 ${String(signInEmail)}`;   // a name nobody in the list carries → Dashboard only
}
/** True while the Users list has no sign-in e-mail at all — the top bar then asks the owner to fill them in. */
export function signInNotLinkedYet(users: AppUser[]): boolean { return (users || []).length > 0 && !(users || []).some(u => String((u as any).email || "").trim()); }

/** May this user open the module? Owner: always. No users defined: always.
 *  Defined users but no match: only the dashboard — visible and explainable. */
// v7.1.15 (owner 6 Oct: "it should not have allowed an owner without a valid e-mail"): on the shared copy an owner entry COUNTS as an
// owner only when it carries a sign-in e-mail — an e-mail-less owner is nobody, so Settings stays open until the owner is reachable.
export function hasOwner(users: AppUser[]): boolean { return (users || []).some(x => x && x.isOwner && (!isSharedMode() || String((x as any).email || "").trim() !== "")); }
export function canOpenModule(users: AppUser[], userName: any, moduleKey: string): boolean {
  const u = currentUser(users, userName);
  if (u === null) return true;
  // v7.1.14 (owner 6 Oct, trapped with no owner entry and two limited users): while NO entry is marked owner, Settings — and only
  // Settings — stays open to every signed-in person, so an owner can be set; the moment an owner exists the ticks decide again.
  // (The same rule as v7.0.2, cancelled when an owner existed; reinstated with a visible banner — see App.)
  if (moduleKey === "settings" && !hasOwner(users)) return true;
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

// ─── v7.2.0 (A-SET-1, owner 6 Oct): THE USERS LIST IS EDITED AS A DRAFT AND SAVED ON PURPOSE ─────────────────────────
/** What a save would change, in plain lines for the confirmation. */
export function usersDiff(before: AppUser[], after: AppUser[]): string[] {
  const out: string[] = []; const B = new Map((before || []).map(u => [String(u.id), u])); const A = new Map((after || []).map(u => [String(u.id), u]));
  const nm = (u: any) => String(u?.name || "").trim() || "(no name)";
  (after || []).forEach(u => { if (!B.has(String(u.id))) out.push(`+ new user ${nm(u)}${u.isOwner ? " (owner)" : ""}${(u as any).email ? ` · ${(u as any).email}` : ""}`); });
  (before || []).forEach(u => { if (!A.has(String(u.id))) out.push(`− REMOVED ${nm(u)}${u.isOwner ? " (the owner)" : ""}`); });
  (after || []).forEach(u => {
    const b: any = B.get(String(u.id)); if (!b) return; const a: any = u;
    if (nm(b) !== nm(a)) out.push(`${nm(b)} renamed to ${nm(a)}`);
    if (!!b.isOwner !== !!a.isOwner) out.push(`${nm(a)}: ${a.isOwner ? "becomes the OWNER" : "is no longer the owner"}`);
    if (String(b.email || "").trim() !== String(a.email || "").trim()) out.push(`${nm(a)}: sign-in e-mail ${String(b.email || "").trim() || "(none)"} → ${String(a.email || "").trim() || "(none)"}`);
    if (String(b.role || "") !== String(a.role || "")) out.push(`${nm(a)}: role label "${b.role || ""}" → "${a.role || ""}"`);
    const ticks = (g: "modules" | "finance") => { const keys = new Set([...Object.keys(b[g] || {}), ...Object.keys(a[g] || {})]); keys.forEach(k => { const x = (b[g] || {})[k], y = (a[g] || {})[k]; const on = (v: any) => (g === "modules" ? v !== false : v === true); if (on(x) !== on(y)) out.push(`${nm(a)}: ${g === "finance" ? "Finance → " : ""}${k} ${on(y) ? "ticked" : "unticked"}`); }); };
    ticks("modules"); ticks("finance");
  });
  return out;
}
/** Why a save must be refused — a list that would lock anyone out is never written. */
export function usersSaveProblems(list: AppUser[], opts: { shared: boolean; signInEmail?: string; typedName?: string }): string[] {
  const p: string[] = []; const L = list || []; if (!L.length) return p;
  const owners = L.filter(u => u.isOwner);
  if (owners.length !== 1) p.push(owners.length ? `${owners.length} entries are marked owner — exactly one may be.` : "No entry is marked owner — exactly one must be.");
  if (opts.shared && owners.length === 1 && !String((owners[0] as any).email || "").trim()) p.push(`The owner "${owners[0].name}" has no sign-in e-mail — on the shared data the owner must be reachable.`);
  L.forEach(u => { if (!String(u.name || "").trim()) p.push("An entry has no name."); });
  if (opts.shared) L.forEach(u => { if (!(u as any).roleId) p.push(`${String(u.name || "").trim() || "A new user"} has no role — choose one.`); if (!String((u as any).email || "").trim()) p.push(`${String(u.name || "").trim() || "A new user"} has no sign-in e-mail.`); });   // v7.5.1 (A-USR-8)
  const names = new Map<string, number>(); L.forEach(u => { const k = String(u.name || "").trim().toLowerCase(); if (k) names.set(k, (names.get(k) || 0) + 1); }); names.forEach((n, k) => { if (n > 1) p.push(`The name "${k}" is used ${n} times.`); });
  const mails = new Map<string, number>(); L.forEach(u => { const k = String((u as any).email || "").trim().toLowerCase(); if (k) mails.set(k, (mails.get(k) || 0) + 1); }); mails.forEach((n, k) => { if (n > 1) p.push(`The sign-in e-mail ${k} is on ${n} entries — one person, one entry.`); });
  L.forEach(u => { const e = String((u as any).email || "").trim(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) p.push(`"${e}" (on ${u.name}) is not an e-mail address.`); });
  // the person saving must keep Settings — nobody saves themselves out
  const me = opts.shared && opts.signInEmail ? userBySignIn(L, opts.signInEmail) : currentUser(L, opts.typedName);
  if (opts.shared && opts.signInEmail && !me) p.push(`Your own sign-in (${opts.signInEmail}) is on no entry — saving would lock you out.`);
  if (me && !me.isOwner && me.modules?.settings === false) p.push(`Your own entry (${me.name}) would lose Settings — saving would lock you out.`);
  return Array.from(new Set(p));
}

// ─── v7.5.0 (A-ROLE-1, owner 6–7 Oct): ONE ROLE MODEL — rights are ticked per ROLE, each user CHOOSES a role ──────────
export interface AppRole { id: string; name: string; isGM?: boolean; modules: Record<string, boolean>; finance: Record<string, boolean> }
const ticks = (keys: readonly string[], on: string[]) => Object.fromEntries(keys.map(k => [k, on.includes(k)]));
const ALL_FIN = [...FINANCE_KEYS];
export const DEFAULT_ROLES: AppRole[] = [
  { id: "gm", name: "General Manager", isGM: true, modules: ticks(MODULE_KEYS, [...MODULE_KEYS]), finance: ticks(FINANCE_KEYS, ALL_FIN) },
  { id: "admin", name: "Administration", modules: ticks(MODULE_KEYS, ["dashboard", "pos", "lots", "orders", "shipments", "invoices", "claims", "contacts"]), finance: ticks(FINANCE_KEYS, []) },
  { id: "finance", name: "Finance", modules: ticks(MODULE_KEYS, ["dashboard", "invoices", "finance", "claims", "contacts", "audit"]), finance: ticks(FINANCE_KEYS, ALL_FIN) },
  { id: "ops", name: "Operations", modules: ticks(MODULE_KEYS, ["dashboard", "pos", "lots", "orders", "shipments", "claims", "contacts"]), finance: ticks(FINANCE_KEYS, []) },
  { id: "sales", name: "Sales", modules: ticks(MODULE_KEYS, ["dashboard", "orders", "lots", "contacts", "claims"]), finance: ticks(FINANCE_KEYS, []) },
  { id: "wh", name: "Warehouse", modules: ticks(MODULE_KEYS, ["dashboard", "lots", "shipments"]), finance: ticks(FINANCE_KEYS, []) },
];
export function rolesOrDefault(roles: any): AppRole[] { return Array.isArray(roles) && roles.length ? roles : DEFAULT_ROLES; }
/** A user's rights written from their role (+ their own extra modules); the General Manager role makes the owner. */
export function materializeUser(u: any, roles: AppRole[]): any {
  const r = (roles || []).find(x => String(x.id) === String(u?.roleId)); if (!r) return u;
  const extra: string[] = Array.isArray(u.extraModules) ? u.extraModules : [];
  const modules = { ...r.modules }; extra.forEach(k => { modules[k] = true; });
  return { ...u, role: r.name, isOwner: !!r.isGM, modules, finance: { ...r.finance } };
}
/** "Operations + Invoices" — the role and the person's own extras, for the list. */
export function rightsSummary(u: any, roles: AppRole[]): string {
  const r = (roles || []).find(x => String(x.id) === String(u?.roleId)); if (!r) return u?.role ? `${u.role} (no role chosen)` : "no role chosen";
  const extra: string[] = (Array.isArray(u.extraModules) ? u.extraModules : []).filter((k: string) => !r.modules[k]);
  return r.name + (extra.length ? ` + ${extra.join(", ")}` : "");
}
