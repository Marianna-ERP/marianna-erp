// release-files.cjs — writes release-files.json: the list of every file in this release (A-DEP-1, v7.23.0).
// Run it when a release is packed (the source gates fail when the list and the repository disagree).
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", "build", ".git", ".vercel", "release-files.json"]);
function walk(dir, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(r) || SKIP.has(e.name) && !rel || r === "tests/build") return [];
    return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
  });
}
const version = (fs.readFileSync(path.join(root, "src/version.ts"), "utf8").match(/APP_VERSION = "([^"]+)"/) || [])[1] || "?";
const files = walk(root).sort();
if (require.main === module) { fs.writeFileSync(path.join(root, "release-files.json"), JSON.stringify({ version, files }, null, 1) + "\n"); console.log(`release-files.json: v${version}, ${files.length} files`); }
module.exports = { walk, root };
