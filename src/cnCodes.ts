// ── v6.99.3: CN (Combined Nomenclature) codes for the produce Marianna trades — SUGGESTIONS only; the user confirms.
// 8-digit CN, chapter 07/08. Customs / phyto / Intrastat classification (not the Polish invoice, which uses PKWiU/GTU).
export const CN_CODES: Array<{ code: string; description: string; keys: string[] }> = [
  { code: "07096010", description: "Sweet peppers (Capsicum annuum), fresh or chilled", keys: ["capsicum", "pepper", "papryka", "bell pepper", "kapia"] },
  { code: "07020000", description: "Tomatoes, fresh or chilled", keys: ["tomato", "pomidor"] },
  { code: "07070005", description: "Cucumbers, fresh or chilled", keys: ["cucumber", "ogórek", "ogorek"] },
  { code: "07093000", description: "Aubergines (eggplants), fresh or chilled", keys: ["eggplant", "aubergine", "bakłażan", "baklazan"] },
  { code: "07049010", description: "White and red cabbages, fresh or chilled", keys: ["cabbage", "kapusta"] },
  { code: "07049090", description: "Other brassicas incl. Chinese cabbage, fresh or chilled", keys: ["chinese cabbage", "pak choi", "kapusta pekińska"] },
  { code: "07031019", description: "Onions, fresh or chilled (other than sets)", keys: ["onion", "cebula"] },
  { code: "07061000", description: "Carrots and turnips, fresh or chilled", keys: ["carrot", "marchew"] },
  { code: "07019050", description: "New potatoes, 1 Jan–30 Jun", keys: ["new potato", "młode ziemniaki"] },
  { code: "07019090", description: "Potatoes, fresh or chilled, other", keys: ["potato", "ziemniak"] },
  { code: "07051900", description: "Lettuce, other than cabbage lettuce", keys: ["lettuce", "sałata"] },
  { code: "07082000", description: "Beans (Vigna, Phaseolus), fresh or chilled", keys: ["bean", "fasola"] },
  { code: "07099990", description: "Other vegetables, fresh or chilled", keys: ["vegetable"] },
  { code: "08081080", description: "Apples, fresh (other than cider apples)", keys: ["apple", "jabłko", "jablko", "gala", "golden", "naidared", "idared", "champion", "ligol"] },
  { code: "08083090", description: "Pears, fresh (other than perry pears)", keys: ["pear", "gruszka", "conference"] },
  { code: "08094005", description: "Plums, fresh", keys: ["plum", "śliwka", "sliwka"] },
  { code: "08092900", description: "Cherries, fresh (other than sour)", keys: ["cherry", "czereśnia", "czeresnia"] },
  { code: "08092100", description: "Sour cherries, fresh", keys: ["sour cherry", "wiśnia", "wisnia"] },
  { code: "08081010", description: "Cider apples, in bulk, 16 Sep–15 Dec", keys: ["cider apple", "jabłka przemysłowe"] },
  { code: "08051022", description: "Navel oranges, fresh", keys: ["navel", "orange navel"] },
  { code: "08051024", description: "White oranges, fresh", keys: ["orange", "pomarańcza", "valencia"] },
  { code: "08052110", description: "Satsumas, fresh", keys: ["satsuma"] },
  { code: "08052190", description: "Mandarins incl. tangerines, fresh", keys: ["mandarin", "tangerine", "mandarynka"] },
  { code: "08052200", description: "Clementines, fresh", keys: ["clementine", "klementynka"] },
  { code: "08055010", description: "Lemons, fresh", keys: ["lemon", "cytryna"] },
  { code: "08055090", description: "Limes, fresh", keys: ["lime", "limonka"] },
  { code: "08054000", description: "Grapefruit and pomelos, fresh", keys: ["grapefruit", "pomelo"] },
  { code: "08061010", description: "Table grapes, fresh", keys: ["grape", "winogrono"] },
  { code: "08071900", description: "Melons (other than watermelons), fresh", keys: ["melon"] },
  { code: "08071100", description: "Watermelons, fresh", keys: ["watermelon", "arbuz"] },
  { code: "08104010", description: "Cowberries, foxberries, cranberries, fresh", keys: ["cranberry", "żurawina"] },
  { code: "08104050", description: "Blueberries (Vaccinium), fresh", keys: ["blueberry", "borówka", "borowka"] },
  { code: "08101000", description: "Strawberries, fresh", keys: ["strawberry", "truskawka"] },
  { code: "08102010", description: "Raspberries, fresh", keys: ["raspberry", "malina"] },
  { code: "08045000", description: "Guavas, mangoes, mangosteens, fresh or dried", keys: ["mango"] },
  { code: "08044000", description: "Avocados, fresh or dried", keys: ["avocado", "awokado"] },
  { code: "08030010", description: "Plantains, fresh", keys: ["plantain"] },
  { code: "08039010", description: "Bananas (other than plantains), fresh", keys: ["banana", "banan"] },
  { code: "08109020", description: "Tamarinds, jackfruit, lychees, sapodilla, passion fruit, carambola, pitahaya, fresh", keys: ["dragonfruit", "pitahaya", "lychee", "passion fruit"] },
  { code: "08109075", description: "Other fruit, fresh", keys: ["fruit"] },
];
export function suggestCN(product: any, variety?: any): Array<{ code: string; description: string }> {
  const q = `${String(product || "")} ${String(variety || "")}`.toLowerCase();
  if (!q.trim()) return [];
  const scored = CN_CODES.map(c => ({ c, best: Math.max(0, ...c.keys.filter(k => q.includes(k)).map(k => k.length)) })).filter(x => x.best > 0).sort((a, b) => b.best - a.best);
  return scored.map(x => ({ code: x.c.code, description: x.c.description }));
}
