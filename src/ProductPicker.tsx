import React from "react";
import { catalogItems, varietiesForItem, addCatalogItem, addCatalogVariety } from "./productCatalog";
import { useConfirm } from "./ui";

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
  const sel: any = { border: "1px solid #E5E7EB", borderRadius: 6, padding: "7px 8px", fontSize: 12.5, fontFamily: "inherit", outline: "none", background: "#fff", width: "100%", boxSizing: "border-box" };

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
