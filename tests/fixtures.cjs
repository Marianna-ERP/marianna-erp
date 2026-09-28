// ══ v6.99.71 (A-TF-1, owner 28 Sept): THE FIXTURES TRAVEL WITH THE CODE ══
// Every real file a suite reads lives in tests/fixtures (see its README). Before this, the suites read a chat's upload
// folder, so 19 round-trip scenarios and 6 screen checks could only run inside that one session; a missing file
// aborted the whole run. Now: one helper, one folder, and a missing fixture is a visible SKIP, never a crash.
const fs = require("fs"); const path = require("path");
const DIR = path.join(__dirname, "fixtures");
const UPLOADS = "/mnt/user-data/uploads";

/** Absolute path of a fixture, or null when it is not there. */
function fixture(name) { const p = path.join(DIR, name); return fs.existsSync(p) ? p : null; }

/** Path of a fixture a scenario cannot do without; prints the skip line when it is missing (the caller then returns). */
function needFixture(name, what) {
  const p = fixture(name);
  if (!p) console.log(`  ⤳ SKIPPED — fixture missing: ${name}${what ? " (" + what + ")" : ""}`);
  return p;
}

/** The owner's data file the screen suites run on: an explicit path, else the NEWEST backup by the date in its name —
 *  among the ones uploaded in this session and the merged 25 Sept file in the repo — so a new file is exercised the
 *  day it arrives and an old one uploaded for another purpose never displaces a newer one. MARIANNA_FIXTURES_ONLY=1
 *  skips the upload folder — that is how the suite is proven to run anywhere. */
function stampOf(p) { const m = path.basename(p).match(/(\d{4}-\d{2}-\d{2})(?:T(\d{2}-\d{2}-\d{2}))?/); return m ? m[1] + (m[2] ? "T" + m[2] : "") : ""; }
function ownerDataFile(explicit) {
  if (explicit) return explicit;
  const candidates = [fixture("marianna-erp_MERGED_2026-09-25.json")].filter(Boolean);
  if (!process.env.MARIANNA_FIXTURES_ONLY) {
    try { fs.readdirSync(UPLOADS).filter(f => /^marianna-erp_.*\.json$/.test(f)).forEach(f => candidates.push(path.join(UPLOADS, f))); } catch { /* no upload folder here */ }
  }
  return candidates.sort((a, b) => stampOf(b).localeCompare(stampOf(a)))[0] || null;
}

module.exports = { DIR, fixture, needFixture, ownerDataFile };
