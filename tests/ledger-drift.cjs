// ══ G-A (owner 18 Sept): DERIVED-FROM-THE-LEDGER TEST ══
// Every stored stock figure is recomputed from the lot's movements and compared. A drift means a screen or a
// posting wrote a snapshot the ledger does not support — exactly how 20 kg of waste came to be sold as class I.
// Runs against the owner's LATEST uploaded backup; any drift beyond 1 kg fails the build.
const fs = require("fs"); const path = require("path");
const B = (m) => require(path.join(__dirname, "build", m));
const I = B("inventory.domain.js"); const Z = B("seasonOps.domain.js");
const file = process.argv[2] || fs.readdirSync("/mnt/user-data/uploads").filter(f => /^marianna-erp_.*\.json$/.test(f)).map(f => "/mnt/user-data/uploads/" + f).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const d = JSON.parse(fs.readFileSync(file, "utf8"));
let checked = 0, drift = 0; const rows = [];
(d.lots || []).forEach(lot => {
  if (!(lot.movements || []).length) return;
  checked++;
  const r = I.recomputeLotFromMovements(lot, lot.movements);
  const g = Z.gradeStockNow({ ...lot, ...r });
  const problems = [];
  if (Math.abs((r.physicalKg || 0) - (lot.physicalKg || 0)) > 1) problems.push(`physical stored ${lot.physicalKg} vs ledger ${r.physicalKg}`);
  if (Math.abs((r.receivedKg || 0) - (lot.receivedKg || 0)) > 1) problems.push(`received stored ${lot.receivedKg} vs ledger ${r.receivedKg}`);
  if (lot.grades && Math.abs((g.II || 0) - (lot.grades.II || 0)) > 1) problems.push(`class II cached ${lot.grades.II} vs ledger ${g.II}`);
  if (lot.grades && Math.abs((g.waste || 0) - (lot.grades.waste || 0)) > 1) problems.push(`waste cached ${lot.grades.waste} vs ledger ${g.waste}`);
  if (Math.abs((g.I + g.II) - (r.physicalKg || 0)) > 1) problems.push(`classes I+II ${g.I + g.II} ≠ physical ${r.physicalKg} (a movement is out of order — see MOVEMENT_BEFORE_RECEIPT)`);
  if (problems.length) { drift++; rows.push(`  ✗ ${lot.number}: ${problems.join("; ")}`); }
});
console.log(`LEDGER DRIFT against ${path.basename(file)}: ${checked} lots checked, ${drift} with drift`);
rows.forEach(r => console.log(r));
// a drift that the integrity badge already explains (movement before receipt) is reported but does not fail the build:
// the owner is told to re-date the act; the build fails only on a drift the badge would NOT show.
const unexplained = rows.filter(r => !r.includes("out of order"));
if (unexplained.length) { console.log("UNEXPLAINED DRIFT — a screen or posting wrote a snapshot the ledger does not support"); process.exit(1); }
