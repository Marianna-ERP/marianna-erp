// ══ v7.21.2 (AUD-50, owner 11 Oct) — ANONYMISE REAL FILES BEFORE THEY BECOME TEST FIXTURES ══
// Usage:  node tests/anonymise.cjs [--dry] DATA_FILES… --tests TEXT_FILES…
//   DATA_FILES: backups (.json), customs files (.xml), workbooks (.xlsx) — rewritten in place (renamed when a name holds an MRN)
//   TEXT_FILES: the test suites and README that name things from those files — only their strings, regexes and comments change
// Every company and person name, tax number, street and postcode, e-mail, phone, bank account, plate, container, seal, booking,
// BL / CMR / AWB / tracking number and MRN becomes an invented one: the same real value always gets the same invented value in
// every file of one run, so the tests keep matching. Kilos, prices, dates, our own document numbers (PO / SO / SHP / LOT …) and
// invoice numbers stay — the tests prove the code on them. Our own company's identity stays: it is in the app's code and on every
// document we send. THE TABLE (real → invented) IS NEVER WRITTEN ANYWHERE: it lives in memory for one run, from a random seed.
// To add a new real file later: anonymise it together with nothing else, then write its tests against the invented names.
"use strict";
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));
const args = process.argv.slice(2); const DRY = args.includes("--dry");
const dataFiles = [], textFiles = []; let into = dataFiles;
for (const a of args) { if (a === "--dry") continue; if (a === "--tests") { into = textFiles; continue; } if (path.resolve(a) === __filename) continue; /* never itself */ into.push(a); }
let seed = crypto.randomBytes(4).readUInt32LE(0);
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const S = v => String(v ?? "").trim();
// ── the table, in memory only ──
const exact = new Map();   // real value → invented value (whole values, matched between non-alphanumerics; names also in any case)
const usedFakes = new Set(); const keep = new Set();
let SRC = ""; try { SRC = fs.readdirSync("src").filter(f => /\.tsx?$/.test(f)).map(f => fs.readFileSync(path.join("src", f), "utf8")).join("\n"); } catch { /* run outside the repo */ }
// a value the app's own code also writes stays as it is: the fixture must keep matching the code (those are registered to leave the code)
const inCode = v => SRC.includes(v) || SRC.toLowerCase().includes(v.toLowerCase());
const SYL = ["ba", "ce", "di", "fo", "gu", "ka", "le", "mi", "no", "pa", "ri", "so", "tu", "va", "ze", "lo", "ma", "ne", "ro", "ta", "vi", "do", "ge", "ki", "lu", "mo", "na", "re", "si", "to"];
const FIRST = ["Anna", "Piotr", "Ewa", "Tomasz", "Marta", "Jan", "Kasia", "Adam", "Ola", "Marek", "Zofia", "Pawel", "Ilona", "Robert", "Agata", "Lukas", "Nora", "Igor", "Lena", "Oskar"];
const LAST = ["Nowacki", "Kowalik", "Lisowski", "Kiloges", "Wronski", "Sowinski", "Krukowski", "Bakowski", "Zajaczek", "Wilczek", "Sokolik", "Dudkowski", "Rybacki", "Kosinski", "Gilewski", "Szpakowski", "Czaplicki", "Mewinski", "Jezewski", "Bobrowski"];
const LEGAL = /(\s*,?\s+(sp\.?\s*z\s*o\.?\s*o\.?|sp\.?\s*j\.?|sp\.?\s*k\.?|s\.?\s*c\.?|s\.?\s*a\.?|kft\.?|zrt\.?|bt\.?|gmbh|s\.?\s*r\.?\s*l\.?|srl|ltd\.?|llc|co\.?|inc\.?|b\.?v\.?|s\.?a\.?e\.?|spółka.*|for import.*))+$/i;
const caseLike = (src, w) => src === src.toUpperCase() && /[A-Z]/.test(src) ? w.toUpperCase() : w;
function fresh(gen) { for (let i = 0; i < 500; i++) { const f = gen(); if (!usedFakes.has(f.toLowerCase()) && !keep.has(f)) { usedFakes.add(f.toLowerCase()); return f; } } throw new Error("no fresh fake"); }
const fakeWord = len => { let w = ""; const n = Math.max(5, Math.min(len, 9)); while (w.length < n) w += pick(SYL); w = w.slice(0, n); return w[0].toUpperCase() + w.slice(1); };   // a generator only: fresh() registers what is kept
const shapeOf = v => (() => v.replace(/[0-9]/g, () => String(Math.floor(rnd() * 10))).replace(/[A-Z]/g, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).replace(/[a-z]/g, () => String.fromCharCode(97 + Math.floor(rnd() * 26))))();
const shapeLike = v => fresh(() => shapeOf(v));
const OUR_DIGITS = [];   // our own tax number, in any identifier built on it (EORI, TIN, "PL…") — ours stays
function put(real, fake) { real = S(real); if (!real || keep.has(real) || exact.has(real) || inCode(real)) return; const dg = real.replace(/\D/g, ""); if (OUR_DIGITS.some(o => dg.includes(o))) return; exact.set(real, fake(real)); }
// numbers: only values that identify something — at least 5 characters, and letters with digits, or 7+ digits, or a postcode
const identifying = v => v.length >= 5 && (/[A-Za-z]/.test(v) && /\d.*\d/.test(v) || (v.match(/\d/g) || []).length >= 7 || /^\d{2}-\d{3}$/.test(v)) && !/^(truck|trailer|unit|container)\s*\d+$/i.test(v);
const num = v => { const x = S(v); if (!x) return;
  const parts = x.split(/\s*[\/,;+]\s*/).map(S).filter(Boolean);
  parts.forEach(p => { if (identifying(p)) put(p, shapeLike);
    const pl = p.match(/^([A-Z]{2,3})(\d[0-9A-Z]{3,5})$/); if (pl && exact.has(p)) { const f = exact.get(p); const sp = pl[1] + " " + pl[2]; if (!exact.has(sp)) exact.set(sp, f.slice(0, pl[1].length) + " " + f.slice(pl[1].length)); } const flat = p.replace(/\s+/g, ""); if (flat !== p && identifying(flat)) { put(flat, shapeLike); if (exact.has(flat) && exact.has(p)) { let k = 0; const f = exact.get(flat); exact.set(p, p.replace(/\S/g, () => f[k++] || "")); } } }); };
function firm(name) {
  name = S(name); if (name.length < 3) return;
  const dw = distinctWords(name);
  if (dw.length) { dw.forEach(w => { if (!words.has(w.toLowerCase())) words.set(w.toLowerCase(), fresh(() => fakeWord(w.length))); }); return; }
  // no distinctive word (e.g. an acronym with a legal form): the core and the whole name become invented — unless the code writes it
  const core = name.replace(LEGAL, "").replace(/^["'„]+|["'”]+$/g, "").trim();
  if (core.length >= 3 && !keep.has(core) && !inCode(core) && (core.length >= 4 || core === core.toUpperCase())) {
    const fc = exact.get(core) || caseLike(core, fresh(() => fakeWord(Math.max(5, core.length)) + (core.includes(" ") ? " " + fakeWord(5) : "")));
    exact.set(core, fc); if (name !== core && !inCode(name)) put(name, () => name.replace(core, fc));
  }
}
function person(name) {
  name = S(name); if (/^(driver|kierowca|truck|unit|n\/a|tbc|tba)\b/i.test(name)) return;
  if (!/\s/.test(name)) { if (name.length >= 5 && !/\d/.test(name) && !keep.has(name) && !inCodeWord(name) && !COMMON.has(name.toLowerCase())) put(name, () => fresh(() => pick(FIRST) + pick(["", "a", "o", "i"]))); return; }
  if (name.length < 5 || /\d/.test(name)) return;
  const parts = name.split(/\s+/); const last = parts[parts.length - 1];
  const fakeLast = (last.length >= 6 && /^[A-ZŁŚŻŹĆŃÓ]/.test(last) && !keep.has(last) && !inCode(last)) ? (exact.get(last) || fresh(() => fakeWord(5) + pick(["ski", "wicz", "czyk", "ak", "ek", "owski"]))) : null;
  if (fakeLast && !exact.has(last)) exact.set(last, fakeLast);
  put(name, () => fresh(() => pick(FIRST) + " " + (fakeLast || (fakeWord(5) + pick(["ski", "wicz", "czyk", "ak", "ek", "owski"])))));
}
const mail = v => { S(v).split(/[\s,;]+/).filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)).forEach(m => put(m, () => fresh(() => "contact" + Math.floor(rnd() * 9000 + 1000) + "@example.com"))); };
const phone = v => { S(v).split(/[,;/]+/).map(S).filter(x => (x.match(/\d/g) || []).length >= 7).forEach(p => { put(p, shapeLike); const dg = p.replace(/[^0-9+]/g, ""); if (dg !== p) put(dg, shapeLike); }); };
const street = (v, city) => { const x = S(v); if (x.length >= 5 && /[A-Za-zÀ-ž]{3}/.test(x) && (/\d/.test(x) || /\s/.test(x)) && !/^\d{2}-?\d{3}\b|^\d{4,6}\b|^[A-Z]{1,2}-?\d{2,5}\b/.test(x) && x.toLowerCase() !== S(city).toLowerCase() && !keepWords.has(x.toLowerCase())) put(x, () => fresh(() => "ul. " + fakeWord(7) + " " + (1 + Math.floor(rnd() * 90)))); };
const addr = a => { if (!a || typeof a !== "object") return; street(a.street, a.city); num(a.postcode); };
// the distinctive words of company names (6+ letters, not a common or legal word, not a product, city or anything the code says)
const words = new Map(); const COMMON = new Set(("import export trading trade logistics logistic transport transports spedycja spedition przedsiebiorstwo przedsiębiorstwo handlowo handlowe handlowy uslugowe usługowe usługowa uslugowa produkcyjno produkcyjne international company limited global services service market fruits fruit vegetables vegetable warzywa owoce owoców owocow warzyw gospodarstwo rolne ogrodnicze spółdzielnia spoldzielnia sadownicze sadowniczy polska poland hungary hungarian egypt egyptian commercial agency agencja celna customs freight forwarding forwarder shipping warehouse magazyn storage holding express partners brothers corporation enterprise industries general supplies products wholesale hurtownia centrum center natural organic quality premium golden united union mobile office driver account director manager purchase dispatcher producentów producentow rolników rolnikow grupa group cargo containers container terminal agricultural agriculture product produce distribution spolka spółka jawna akcyjna komandytowa cywilna odpowiedzialnością odpowiedzialnoscia ograniczoną ograniczona").split(/\s+/));
const keepWords = new Set();
const codeWord = new Map(); const inCodeWord = w => { const k = w.toLowerCase(); if (!codeWord.has(k)) codeWord.set(k, new RegExp("(?<![A-Za-zÀ-ž])" + w + "(?![A-Za-zÀ-ž])", "i").test(SRC)); return codeWord.get(k); };
const distinctWords = name => S(name).split(/[^A-Za-zÀ-ž]+/).filter(w => w.length >= 6 && !COMMON.has(w.toLowerCase()) && !keep.has(w) && !keepWords.has(w.toLowerCase()) && !inCodeWord(w));
const addWords = name => { /* folded into firm() */ };
// ── 1. collect what identifies people and companies (our own company excluded) ──
function collect(d) {
  const co = d.company || {}; [co.name, co.nip, co.address, co.email, co.phone].forEach(v => { if (S(v)) { keep.add(S(v)); S(v).split(/[\n,;]+/).map(S).filter(Boolean).forEach(x => keep.add(x)); } });
  if (S(co.nip)) { const dg = S(co.nip).replace(/\D/g, ""); [dg, "PL" + dg].forEach(v => keep.add(v)); if (dg.length >= 8) OUR_DIGITS.push(dg); }
  // identifiers of declarations and parties wherever they are kept: ACID, import permits, EORI, TIN, REGON, KRS, tax numbers
  (function deep(o) { if (Array.isArray(o)) return o.forEach(deep); if (!o || typeof o !== "object") return; for (const [k, v] of Object.entries(o)) { if (typeof v === "string" && /^(acidNo|importPermitNo|eori|tin|regon|krs|taxNo|taxId|vatNo|vatEuId|nip)$/i.test(k)) { num(v); const dg = v.replace(/[^0-9A-Za-z]/g, ""); if (/^\d{10}$/.test(dg)) num("PL" + dg); } else deep(v); } })(d);
  (d.productCatalog || []).forEach(it => { [it.item, ...(it.varieties || []).map(v => typeof v === "object" ? v.name : v)].forEach(v => S(v).split(/[^A-Za-zÀ-ž]+/).forEach(w => keepWords.add(w.toLowerCase()))); });
  (d.contacts || []).concat(d.customLocations || []).forEach(c => [c.addr && c.addr.city, c.city].forEach(v => S(v).split(/[^A-Za-zÀ-ž]+/).forEach(w => keepWords.add(w.toLowerCase()))));
  (d.contacts || []).forEach(c => {
    firm(c.name); num(c.nip); num(c.vatEuId); [c.nip, c.vatEuId].forEach(v => { const dg = S(v).replace(/[^0-9A-Za-z]/g, ""); if (dg !== S(v)) num(dg); if (/^\d{10}$/.test(dg)) num("PL" + dg); }); addr(c.addr); mail(c.email); phone(c.phone);
    S(c.address).split(/[\n,;]+/).map(S).forEach(street);
    (c.people || []).forEach(p => { person(p.name); mail(p.email); phone(p.phone); });
    (c.contacts || []).forEach(p => { if (p && typeof p === "object") { person(p.name || p.person); mail(p.email); phone(p.phone); } else person(p); });
    (c.extraAddresses || []).forEach(a => a && typeof a === "object" ? addr(a.addr || a) : street(a));
    (c.bankAccounts || []).forEach(b => num(typeof b === "object" ? (b.iban || b.number || b.account) : b));
  });
  (d.customLocations || []).forEach(l => { addr(l.addr); S(l.address).split(/[\n,;]+/).map(S).forEach(street); });
  (d.users || []).forEach(u => { person(u.name); mail(u.email); });
  (d.shipments || []).forEach(s => {
    (s.legs || []).forEach(l => (l.vehicles || []).forEach(v => { ["truckPlate", "trailerPlate", "announcedPlate"].forEach(k => S(v[k]).split(/\s*[\/,;+]\s*/).map(S).filter(x => x.length >= 5 && /[A-Za-z]/.test(x) && /\d/.test(x) && !/^(truck|trailer|unit|producer)/i.test(x)).forEach(x => { put(x, shapeLike); const fl = x.replace(/\s+/g, ""); if (fl !== x) put(fl, shapeLike); })); ["truckPlate", "trailerPlate", "announcedPlate", "containerNumber", "sealNumber", "bookingNumber", "blNumber", "awbNumber", "cmrNumber", "tempRecorderNo"].forEach(k => num(v[k])); person(v.driverName); phone(v.driverPhone); }));
    (s.bookings || []).forEach(b => { num(b.number); num(b.blNumber); });
    num(s.docsCourierTrackingNo); const cu = s.customs || {}; num(cu.declRef); num(cu.mrn);
  });
  (d.inspections || []).forEach(x => person(x.inspector));
  (d.invoices || []).forEach(i => { const cp = i.counterparty || {}; if (typeof cp === "object") { firm(cp.name); addWords(cp.name); num(cp.nip || cp.taxNo); } });
  (d.auditLog || []).forEach(a => { if (/@/.test(S(a.user))) mail(a.user); else person(a.user); });
  JSON.stringify(d).replace(/[\p{L}0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/giu, m => { mail(m); return m; });   // e-mails typed anywhere
}
const MRN = /\b\d{2}[A-Z]{2}[A-Z0-9]{14}\b/g;
function collectText(txt) {
  (txt.match(/\b(NIP|TIN|EORI|REGON|KRS)="[^"]+"/g) || []).forEach(a => num(a.replace(/^[A-Z]+="|"$/g, "")));
  (txt.match(/[\p{L}0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/giu) || []).forEach(m => mail(m));
  (txt.match(MRN) || []).forEach(m => put(m, v => fresh(() => v.slice(0, 10) + shapeOf(v.slice(10)))));
  (txt.match(/<identificationNumber>[^<]+<\/identificationNumber>/g) || []).forEach(x => num(x.replace(/<[^>]+>/g, "")));
}
// ── 2. replace whole values, longest first; names in any case ──
let exactRe = null;
function build() {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ex = [...exact.keys()].sort((a, b) => b.length - a.length);
  exactRe = ex.length ? new RegExp("(?<![A-Za-zÀ-ž0-9])(" + ex.map(esc).join("|") + ")(?![A-Za-zÀ-ž0-9])", "giu") : null;
  const low = new Map([...exact].map(([k, v]) => [k.toLowerCase(), v]));
  anon.get = m => exact.get(m) ?? caseLike(m, low.get(m.toLowerCase()) ?? m);
  for (const w of [...words.keys()]) if (keepWords.has(w)) words.delete(w);
  const ws = [...words.keys()].sort((a, b) => b.length - a.length);
  wordRe = ws.length ? new RegExp("(?<![A-Za-zÀ-ž0-9])(" + ws.map(esc).join("|") + ")(?![A-Za-zÀ-ž0-9])", "giu") : null;
}
let wordRe = null;
function anon(s) {
  if (typeof s !== "string" || !s) return s;
  let o = exactRe ? s.replace(exactRe, m => anon.get(m)) : s;
  if (wordRe) o = o.replace(wordRe, m => { const f = words.get(m.toLowerCase()); return m === m.toUpperCase() ? f.toUpperCase() : m === m.toLowerCase() ? f.toLowerCase() : f; });
  return o;
}
const walk = v => Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "company" ? x : walk(x)])) : anon(v);
function anonCode(src) {   // only strings, template parts, regexes and comments of a test file change — never its code
  const K = ts.SyntaxKind; const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
  let out = "", last = 0, prev = K.Unknown, tok;
  while ((tok = sc.scan()) !== K.EndOfFileToken) {
    if ((tok === K.SlashToken || tok === K.SlashEqualsToken) && ![K.Identifier, K.CloseParenToken, K.CloseBracketToken, K.NumericLiteral, K.StringLiteral].includes(prev)) tok = sc.reScanSlashToken();
    if (tok === K.CloseBraceToken) { const t2 = sc.reScanTemplateToken(false); if (t2 === K.TemplateMiddle || t2 === K.TemplateTail) tok = t2; }
    const a = sc.getTokenStart ? sc.getTokenStart() : sc.getTokenPos(), b = sc.getTextPos();
    const text = [K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.RegularExpressionLiteral, K.SingleLineCommentTrivia, K.MultiLineCommentTrivia].includes(tok);
    out += src.slice(last, a) + (text ? anon(src.slice(a, b)) : src.slice(a, b)); last = b;
    if (![K.WhitespaceTrivia, K.NewLineTrivia, K.SingleLineCommentTrivia, K.MultiLineCommentTrivia].includes(tok)) prev = tok;
  }
  return out + src.slice(last);
}
// ── run ──
const isJson = f => /\.json$/i.test(f), isXml = f => /\.xml$/i.test(f), isXlsx = f => /\.xlsx$/i.test(f);
const parsed = new Map();
for (const f of dataFiles.filter(isJson)) { const d = JSON.parse(fs.readFileSync(f, "utf8")); parsed.set(f, d); collect(d.data && !d.contacts ? d.data : d); collectText(fs.readFileSync(f, "utf8")); }
for (const f of [...dataFiles.filter(isXml), ...dataFiles]) collectText(path.basename(f) + (isXml(f) ? fs.readFileSync(f, "utf8") : ""));
for (const k of [...exact.keys()]) if (keep.has(k)) exact.delete(k);
const fold = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
for (const [k, v] of [...exact]) { const f = fold(k); if (f !== k && !exact.has(f) && !keep.has(f) && !inCode(f)) exact.set(f, v); }
for (const [k, v] of [...words]) { const f = fold(k); if (f !== k && !words.has(f)) words.set(f, v); }
build();
console.log(`ANONYMISE: ${exact.size} values and ${words.size} name words to replace; ${keep.size} values of our own company kept`);
if (DRY) process.exit(0);
const pretty = f => /\n  "/.test(fs.readFileSync(f, "utf8").slice(0, 300));
for (const [f, d] of parsed) { const out = walk(d); fs.writeFileSync(f, pretty(f) ? JSON.stringify(out, null, 2) : JSON.stringify(out)); }
for (const f of dataFiles.filter(isXml)) fs.writeFileSync(f, anon(fs.readFileSync(f, "utf8")));
for (const f of dataFiles.filter(isXlsx)) { const CFB = require(require.resolve("xlsx", { paths: [process.cwd()] })).CFB; const z = CFB.read(fs.readFileSync(f), { type: "buffer" });
  z.FileIndex.forEach((e, i) => { if (/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(z.FullPaths[i]) && e.content) { const s = Buffer.from(e.content).toString("utf8"), n = anon(s.replace(/&#(\d+);/g, (m, c) => +c > 127 ? String.fromCodePoint(+c) : m)); if (n !== s) e.content = Buffer.from(n, "utf8"); } });
  fs.writeFileSync(f, CFB.write(z, { fileType: "zip", type: "buffer" })); }
for (const f of textFiles) { const t = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, /\.c?js$/i.test(f) ? anonCode(t) : anon(t)); }
for (const f of dataFiles) { const nb = anon(path.basename(f)); if (nb !== path.basename(f)) fs.renameSync(f, path.join(path.dirname(f), nb)); }
console.log("ANONYMISE: done — the table is gone with this run.");
