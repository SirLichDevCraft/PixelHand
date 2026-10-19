// PHASE 8 GATE — the coverage matrix, proven not claimed (docs/08 §4, PLAN.md §5 Phase 8).
//
// T1-T12 are deliberately maximally distant points in the nine-axis space. Each lives in its own
// module under bench/coverage/, declares its own coordinate (no preset), authors its own pixels,
// and returns claims with the numbers behind them. A claim that failed stays in the report.
//
//   node bench/gate8-coverage.js            all modules
//   node bench/gate8-coverage.js T1 T5      a subset
"use strict";

const fs = require("fs");
const path = require("path");
const { TOOLS, W } = require("../src/tools.js");

const HERE = path.join(__dirname, "coverage");
const ROOT = path.join(__dirname, "..", "out", "gate8");
const REPORT = path.join(__dirname, "..", "out", "gate8-report.txt");

const LINES = [];
const say = (s = "") => { LINES.push(s); console.log(s); };

const only = process.argv.slice(2).map(s => s.toUpperCase());
const files = fs.readdirSync(HERE).filter(f => f.endsWith(".js")).sort();
const modules = [];
for (const f of files) {
  const m = require(path.join(HERE, f));
  if (!m || !m.id || typeof m.run !== "function") { say(`SKIP ${f}: not a coverage module (needs id, title, claims, run)`); continue; }
  if (only.length && !only.includes(m.id.toUpperCase())) continue;
  modules.push(m);
}

// The preset check: which style bibles and palettes existed before this gate ran.
const preexistingStyles = new Set(fs.existsSync(path.join(__dirname, "..", "art", "styles"))
  ? fs.readdirSync(path.join(__dirname, "..", "art", "styles")).map(f => f.replace(/\.json$/, "")) : []);
const preexistingPalettes = new Set(fs.existsSync(path.join(__dirname, "..", "art", "palettes"))
  ? fs.readdirSync(path.join(__dirname, "..", "art", "palettes")).map(f => f.replace(/\.json$/, "")) : []);

say("PHASE 8 GATE — the coverage matrix");
say(`  ${modules.length} coordinate module(s) found in bench/coverage/`);
say(`  presets on disk before this gate: styles [${[...preexistingStyles].join(", ")}] palettes [${[...preexistingPalettes].join(", ")}]\n`);

const results = [];
for (const m of modules) {
  const out = path.join(ROOT, m.id.toLowerCase());
  say(`--- ${m.id} · ${m.title}`);
  say(`    proves: ${m.proves}`);
  let r = null;
  try {
    r = m.run({ T: TOOLS, W, OUT: out, ROOT: out, say: (s) => say(`    ${s}`), preexistingStyles, preexistingPalettes });
  } catch (e) {
    say(`    THREW: ${e.message}`);
    if (process.env.PIXELHAND_TRACE) say(e.stack);
    r = { claims: (m.claims || []).map(c => ({ claim: c, ok: false, evidence: `module threw: ${e.message}` })), artifacts: [], notes: [] };
  }
  // every declared claim must be answered
  const returned = new Set((r.claims || []).map(c => c.claim));
  const unanswered = (m.claims || []).filter(c => !returned.has(c)).map(c => ({ claim: c, ok: false, evidence: "claim never measured" }));
  const claims = [...(r.claims || []), ...unanswered];
  const presetClaim = claims.find(c => /no preset|declared from scratch/i.test(c.claim));
  const usedPreset = m.coordinate && (preexistingStyles.has(m.coordinate.id));
  const passed = claims.filter(c => c.ok).length;
  say(`    claims ${passed}/${claims.length} passed${usedPreset ? "  [STYLE IS A PRESET — not 'no preset']" : ""}`);
  for (const c of claims) say(`      ${c.ok ? "PASS" : "FAIL"}  ${c.claim}\n            ${c.evidence}`);
  for (const n of r.notes || []) say(`      note   ${n}`);
  say("");
  results.push({ id: m.id, title: m.title, proves: m.proves, claims, passed, total: claims.length, artifacts: r.artifacts || [], notes: r.notes || [], threw: !!r.threw, presetIndependent: !usedPreset && !!presetClaim?.ok });
}

// ---- the coverage gate itself ---------------------------------------------------
const totalClaims = results.reduce((s, r) => s + r.total, 0);
const passedClaims = results.reduce((s, r) => s + r.passed, 0);
const failing = results.filter(r => r.passed < r.total);
const noPreset = results.filter(r => r.presetIndependent).length;
const authored = results.length;

say("=== COVERAGE GATE ===");
say(`  coordinates attempted      ${authored} of 12 (docs/08 §4)`);
say(`  claims passed              ${passedClaims}/${totalClaims}`);
say(`  produced with no preset    ${noPreset} (gate requires >= 3)`);
for (const r of results) say(`  ${r.id.padEnd(4)} ${String(r.passed).padStart(2)}/${String(r.total).padEnd(2)} ${r.title}`);
if (failing.length) { say(""); say(`  FAILING COORDINATES: ${failing.map(f => f.id).join(", ")}`); }
fs.writeFileSync(REPORT, LINES.join("\n"));
say(`\nreport written: ${REPORT}`);
process.exitCode = failing.length === 0 && authored === 12 && noPreset >= 3 ? 0 : 1;
