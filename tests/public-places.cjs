// v7.32.0 (FZ-04a): the checks' own seam for public places. The app holds no list of places in its code any more; a fixture whose
// documents use the old port numbers gets them seeded into the public-places store here — exactly what the app's copy-back did —
// so the fixtures keep resolving. This list exists ONLY for the checks.
const PORTS = [[6, "Gdańsk Port", "Poland"], [7, "Hamburg Port", "Germany"], [23, "Agadir / Casablanca port area", "Morocco"], [108, "Algeciras Port", "Spain"], [109, "Jeddah Islamic Port", "Saudi Arabia"], [110, "Venice / Marghera Port", "Italy"], [111, "Rotterdam Port", "Netherlands"], [112, "Antwerp-Bruges Port", "Belgium"], [113, "Koper Port", "Slovenia"], [114, "Trieste Port", "Italy"], [115, "Genoa Port", "Italy"], [116, "Salerno Port", "Italy"], [117, "Valencia Port", "Spain"], [118, "Barcelona Port", "Spain"], [119, "Alexandria Port", "Egypt"], [120, "Port Said", "Egypt"], [121, "Agadir / Casablanca port area", "Morocco"], [122, "Ravenna Port", "Italy"], [123, "Rijeka Port", "Croatia"], [124, "Bremerhaven Port", "Germany"], [125, "Gdynia Port", "Poland"], [126, "Damietta Port", "Egypt"]];
const AIRPORTS = [[201, "Warsaw Chopin Airport — Cargo", "Poland"], [202, "Frankfurt Cargo Airport", "Germany"]];
const OWN = [[1, "WH-01 Poznań (Logipark)", "Poland", "RentedWarehouse", "Poznań / Logipark"], [2, "WH-02 Warszawa (ColdStore)", "Poland", "RentedWarehouse", "Warszawa cold storage"]];
const PUBLIC = [...PORTS.map(([id, name, country]) => ({ id, name, country, type: "Port", legacyType: "PORT" })), ...AIRPORTS.map(([id, name, country]) => ({ id, name, country, type: "Airport", legacyType: "PORT" }))];
const ALL = [...PUBLIC, ...OWN.map(([id, name, country, type, address]) => ({ id, name, country, type, legacyType: "OWN", address }))];
const KEY = /^(.*LocationId|locationId|toId|fromId|polId|podId|originId|destinationId|loadingPlaceId|unloadingPlaceId|placeId)$/;
function usedIds(data) { const out = new Set(); const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (KEY.test(k) && v != null && v !== "") out.add(String(v)); else if (v && typeof v === "object") walk(v); } }; [data.pos, data.orders, data.lots, data.shipments].forEach(walk); return out; }
/** Seed into the fixture's public-places store (localStorage) every old-list place its documents use; returns how many were added. */
function seed(localStorage, data, key = "marianna-erp:v2:customLocations") {
  const used = usedIds(data); let list = []; try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch { list = []; } if (!Array.isArray(list)) list = [];
  const have = new Set(list.map(l => String(l.id))); let added = 0;
  ALL.forEach(p => { if (used.has(String(p.id)) && !have.has(String(p.id))) { list.push({ ...p, fromBuiltIn: true }); added++; } });
  if (added) localStorage.setItem(key, JSON.stringify(list)); return added;
}
module.exports = { PUBLIC_PLACES: PUBLIC, OLD_LIST: ALL, seed, usedIds };
