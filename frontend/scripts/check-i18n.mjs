// Checks that every UI string wrapped in t("...") / tn("...", "...") has a Turkish entry
// in src/i18n/tr.ts. Run with `node scripts/check-i18n.mjs` (also runs before `npm run build`).
// `--list` prints the missing keys as JSON.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|ts)$/.test(f) && !p.includes(`${sep}i18n${sep}`)) files.push(p);
  }
})(root);

const str = String.raw`"((?:[^"\\]|\\.)*)"`;
const reT = new RegExp(String.raw`\bt\(\s*` + str, "g");
const reTn = new RegExp(String.raw`\btn\(\s*` + str + String.raw`\s*,\s*` + str, "g");
const unescape = (s) => JSON.parse(`"${s}"`);
const keys = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(reT)) keys.set(unescape(m[1]), f);
  for (const m of src.matchAll(reTn)) { keys.set(unescape(m[1]), f); keys.set(unescape(m[2]), f); }
}

// Keys used through variables (t(x.q), t(source), ...) are listed in tr.ts under DYNAMIC_KEYS.
const trSrc = readFileSync(join(root, "i18n/tr.ts"), "utf8");
const trKeys = new Set();
for (const m of trSrc.matchAll(new RegExp(String.raw`^\s*` + str + String.raw`\s*:`, "gm"))) trKeys.add(unescape(m[1]));

const missing = [...keys.keys()].filter((k) => !trKeys.has(k));
if (process.argv.includes("--list")) {
  console.log(JSON.stringify(missing, null, 1));
} else if (missing.length) {
  console.error(`i18n: ${missing.length} UI string(s) have no Turkish entry in src/i18n/tr.ts:`);
  for (const k of missing) console.error(`  ${JSON.stringify(k)}  (${keys.get(k).replace(root, "src/")})`);
  process.exit(1);
} else {
  console.log(`i18n: all ${keys.size} UI strings have Turkish text.`);
}
