import React from "react";
import { catalogItems, varietiesForItem, addCatalogItem, addCatalogVariety, valuesForItem, addCatalogValue } from "./productCatalog";   // v7.18.3: + the item's calibre / coloration lists
import { useConfirm } from "./ui";
import { findPackaging, packagingTypeFromForm } from "./packaging.domain";   // v7.18.0 (A-AU-1)
import { recordAudit } from "./audit";

// v6.18.16: dependent Item → Variety picker used on PO and SO lines. Both write to
// the one shared productCatalog; "➕ Add new…" adds to that same list (no duplicate
// source). Legacy free-typed values still show (marked "not in list") so existing
// data is never lost.
export function ItemVarietyPicker({ catalog = [], setCatalog, item = "", variety = "", onItem, onVariety }: any) {
  const { prompt: uiPrompt, dialogNode: ppNode } = useConfirm(); // P2-6
  const items = catalogItems(catalog);
  const itemInList = !item || items.some((i: string) => i.toLowerCase() === String(item).toLowerCase());
  const vars = varietiesForItem(catalog, item);
  const varInList = !variety || vars.some((v: string) => v.toLowerCase() === String(variety).toLowerCase());
  const sel: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 8px", fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff", width: "100%", boxSizing: "border-box" };

  const onItemChange = async (val: string) => {
    if (val === "__add__") {
      const name = ((await uiPrompt({ title: "New item", message: "Add a new item to the product catalog:", placeholder: "e.g. Oranges", confirmLabel: "Add" })) || "").trim();
      if (!name) return;
      if (setCatalog) setCatalog((c: any) => addCatalogItem(c || [], name));
      onItem && onItem(name); onVariety && onVariety("");
      return;
    }
    onItem && onItem(val); onVariety && onVariety(""); // item changed → clear variety
  };
  const onVarChange = async (val: string) => {
    if (val === "__add__") {
      const name = ((await uiPrompt({ title: "New variety", message: `Add a new variety for ${item || "item"} to the catalog:`, placeholder: "e.g. Valencia", confirmLabel: "Add" })) || "").trim();
      if (!name) return;
      if (setCatalog && item) setCatalog((c: any) => addCatalogVariety(c || [], item, name));
      onVariety && onVariety(name);
      return;
    }
    onVariety && onVariety(val);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {ppNode}
      <select value={itemInList ? item : ""} onChange={e => onItemChange(e.target.value)} style={sel} title="Product item">
        <option value="">— Item —</option>
        {!itemInList && item ? <option value={item}>{item} (not in list)</option> : null}
        {items.map((i: string) => <option key={i} value={i}>{i}</option>)}
        <option value="__add__">➕ Add new item…</option>
      </select>
      <select value={varInList ? variety : ""} onChange={e => onVarChange(e.target.value)} disabled={!item} style={{ ...sel, background: item ? "#fff" : "#F9FAFB" }} title="Variety">
        <option value="">— Variety —</option>
        {!varInList && variety ? <option value={variety}>{variety} (not in list)</option> : null}
        {vars.map((v: string) => <option key={v} value={v}>{v}</option>)}
        {item ? <option value="__add__">➕ Add new variety…</option> : null}
      </select>
    </div>
  );
}

// ── v7.18.0 (A-AU-1, owner 9 Oct — P-8): THE PACKAGING IS PICKED, never typed ──────────────────────────────────────────────
// The one list is Settings → Packaging types (the live ones). "＋ New packaging type…" adds to that same list, with the same checks,
// and picks it. A line typed before keeps its words, shown in amber as "typed — not linked", until a type is picked here or the
// spelling is linked once in Settings → Packaging types. Kilos per box, tare and the pallet table come from the type.
const PK_SEL: any = { width: "100%", border: "1px solid #E5E7EB", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "#111", outline: "none", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" };
export function PackagingPicker({ types = [], setTypes = null, packaging = "", packagingId = null, onPick, disabled = false }: any) {
  const { alert: pkAlert, dialogNode } = useConfirm();
  const [adding, setAdding] = React.useState<any>(null);
  const live = (types || []).filter((t: any) => t && !t.deleted).slice().sort((a: any, b: any) => String(a.label).localeCompare(String(b.label), "pl"));
  const hasId = packagingId != null && String(packagingId) !== "";
  const cur = hasId ? findPackaging(live, packagingId) : findPackaging(live, packaging);
  const typed = !cur && String(packaging || "").trim() ? String(packaging).trim() : "";
  const change = (v: string) => {
    if (v === "__new__") { setAdding({ label: "", capacityKg: "", tareKg: "", boxesPerPallet: "", palletTareKg: "" }); return; }
    if (v === "__typed__") return;
    if (!v) { onPick && onPick(null); return; }
    const t = live.find((x: any) => String(x.id) === v); if (t && onPick) onPick(t);
  };
  const save = async () => {
    const r = packagingTypeFromForm(adding, types || []);
    if (!r.type) { await pkAlert({ tone: "warn", title: "New packaging type", message: r.error || "" }); return; }
    const t = r.type;
    setTypes((prev: any[]) => [...(prev || []).filter((x: any) => String(x.id) !== String(t.id)), t]);
    recordAudit({ module: "Settings", docType: "Packaging", docNumber: t.label, action: r.restored ? "updated" : "created", summary: `Packaging type "${t.label}" ${r.restored ? "brought back" : "added"} from an order line — ${t.capacityKg} kg per box, tare ${t.tareKg} kg` });
    onPick && onPick(t); setAdding(null);
  };
  const f = (k: string, label: string, ph: string, num = true) => <div><div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 3 }}>{label}</div>
    <input value={adding?.[k] ?? ""} inputMode={num ? "decimal" : undefined} onChange={e => setAdding((a: any) => ({ ...a, [k]: e.target.value }))} placeholder={ph} style={PK_SEL} /></div>;
  return (<>
    {dialogNode}
    <select data-packaging-picker="1" value={cur ? String(cur.id) : (typed ? "__typed__" : "")} disabled={disabled} onChange={e => change(e.target.value)}
      title={typed ? "Typed before the list — pick its packaging type (or link the spelling once in Settings → Packaging types)" : "Settings → Packaging types: kilos per box, tare and pallets come from the type"}
      style={{ ...PK_SEL, ...(typed ? { borderColor: "#F59E0B", background: "#FFFBEB" } : {}), ...(disabled ? { background: "#F9FAFB" } : {}) }}>
      <option value="">— packaging —</option>
      {typed ? <option value="__typed__">{typed} (typed — not linked)</option> : null}
      {live.map((t: any) => <option key={String(t.id)} value={String(t.id)}>{t.label}</option>)}
      {setTypes ? <option value="__new__">＋ New packaging type…</option> : null}
    </select>
    {adding && <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div data-new-packaging="1" style={{ background: "#fff", borderRadius: 12, width: "min(520px, 100%)", padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>New packaging type</div>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>It joins Settings → Packaging types, so every order line can pick it.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>{f("label", "Name", "e.g. Carton (8 kg)", false)}</div>
          {f("capacityKg", "Holds (kg)", "8")}{f("tareKg", "Empty (kg)", "0.6")}{f("boxesPerPallet", "Boxes / pallet", "96")}{f("palletTareKg", "Pallet (kg)", "25")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={() => setAdding(null)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={save} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add type</button>
        </div>
      </div>
    </div>}
  </>);
}

// ── v7.18.3 (A-AU-5, owner 9 Oct — P-8): CALIBRE AND COLORATION ARE PICKED from the item's lists in Settings → Catalog ─────────
// "➕ Add a calibre…" adds the value to the catalog first, then picks it. A value written before that is not on the list stays,
// shown in amber as "not in the catalog", until another is picked (or it is added to the list in Settings → Catalog).
export function CatalogValuePicker({ catalog = [], setCatalog = null, item = "", kind = "calibres", value = "", onChange, disabled = false }: any) {
  const { prompt: uiPrompt, dialogNode } = useConfirm();
  const vals = valuesForItem(catalog, item, kind);
  const v = String(value ?? "").trim();
  const exact = vals.find((x: string) => x.toLowerCase() === v.toLowerCase());
  const word = kind === "calibres" ? "calibre" : "coloration";
  const change = async (val: string) => {
    if (val === "__typed__") return;
    if (val === "__add__") {
      const name = String((await uiPrompt({ title: `New ${word}`, message: `Add a ${word} for ${item} to the catalog:`, placeholder: kind === "calibres" ? "e.g. 70-80" : "e.g. 70%+", confirmLabel: "Add" })) || "").trim();
      if (!name || !setCatalog) return;
      setCatalog((c: any) => addCatalogValue(c || [], item, kind, name));
      recordAudit({ module: "Settings", docType: "Catalog", docNumber: String(item), action: "updated", summary: `${kind === "calibres" ? "Calibre" : "Coloration"} "${name}" added to ${item} from an order line` });
      onChange && onChange(name); return;
    }
    onChange && onChange(val);
  };
  return (<>
    {dialogNode}
    <select data-catalog-value={kind} value={!v ? "" : (exact || "__typed__")} disabled={disabled || !item} onChange={e => change(e.target.value)}
      title={!item ? "Pick the item first — its calibres and colorations are in Settings → Catalog" : (v && !exact ? "Written before the list — pick a value from the catalog" : "")}
      style={{ ...PK_SEL, ...(v && !exact ? { borderColor: "#F59E0B", background: "#FFFBEB" } : {}), ...(disabled || !item ? { background: "#F9FAFB" } : {}) }}>
      <option value="">{item ? `— ${word} —` : "— pick the item first —"}</option>
      {v && !exact ? <option value="__typed__">{v} (not in the catalog)</option> : null}
      {vals.map((x: string) => <option key={x} value={x}>{x}</option>)}
      {item && setCatalog ? <option value="__add__">➕ Add a {word}…</option> : null}
    </select>
  </>);
}
