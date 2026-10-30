// scripts/import-loops.cjs — v7.42.0 (AUD3-A6): the groups of source files that import each other in a loop (Tarjan), for the no-new-loops rule
const fs = require("fs"), path = require("path"); const src = path.join(process.cwd(), "src");
function loops() {
  const files = fs.readdirSync(src).filter(f => /\.(ts|tsx)$/.test(f)); const id = f => f.replace(/\.(ts|tsx)$/, "");
  const g = new Map(files.map(f => [id(f), []]));
  files.forEach(f => { const c = fs.readFileSync(path.join(src, f), "utf8"); const re = /from "\.\/([\w.-]+)"/g; let m; while ((m = re.exec(c))) { const to = m[1].replace(/\.(ts|tsx)$/, ""); if (g.has(to)) g.get(id(f)).push(to); } });
  let i = 0; const idx = new Map(), low = new Map(), st = [], on = new Set(); let sccs = 0, inLoops = 0;
  const visit = v => { idx.set(v, i); low.set(v, i); i++; st.push(v); on.add(v);
    for (const w of g.get(v)) { if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w))); }
    if (low.get(v) === idx.get(v)) { const comp = []; let w; do { w = st.pop(); on.delete(w); comp.push(w); } while (w !== v); if (comp.length > 1 || g.get(v).includes(v)) { sccs++; inLoops += comp.length; } } };
  for (const v of g.keys()) if (!idx.has(v)) visit(v);
  return { groups: sccs, files: inLoops };
}
module.exports = { loops }; if (require.main === module) console.log(JSON.stringify(loops()));
