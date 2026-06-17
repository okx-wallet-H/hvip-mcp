import { readFileSync, writeFileSync } from "node:fs"

let s = readFileSync("src/tools/agent-utils.ts", "utf8")

// ── Find a `const NAME = { ... }` block by tracking brace depth ──────────
function findBlock(src, constName) {
  const start = src.indexOf(constName)
  if (start < 0) return null
  let i = src.indexOf("{", start)
  if (i < 0) return null
  let depth = 1
  i++
  while (depth > 0 && i < src.length) {
    if (src[i] === "{") depth++
    if (src[i] === "}") depth--
    i++
  }
  return { start, end: i }
}

// ── Extract CATALOG ──────────────────────────────────────────────────────
const cat = findBlock(s, "const CATALOG = {")
console.log("CATALOG:", cat.start, "-", cat.end, "(" + (cat.end - cat.start) + " chars)")

// ── Extract DOMAIN_DETAILS ───────────────────────────────────────────────
const dom = findBlock(s, "const DOMAIN_DETAILS: Record<string, any> = {")
console.log("DOMAIN_DETAILS:", dom.start, "-", dom.end, "(" + (dom.end - dom.start) + " chars)")

// ── Write data files ─────────────────────────────────────────────────────
const catBlock = s.slice(cat.start, cat.end)
writeFileSync("src/tools/agent-catalog-data.ts",
  "/** Agent Catalog — 15 域工具地图. 详见 agent-utils.ts */\n\nexport " + catBlock + "\n")
console.log("Wrote agent-catalog-data.ts")

const domBlock = s.slice(dom.start, dom.end)
writeFileSync("src/tools/agent-domain-details.ts",
  "/** 域工具详情 — agent_catalog_detail 使用. 详见 agent-utils.ts */\n\nexport " + domBlock + "\n")
console.log("Wrote agent-domain-details.ts")

// ── Update agent-utils.ts ────────────────────────────────────────────────
// Replace the two data blocks with references to imported constants
// Do it in reverse order so positions don't shift
let updated = s
updated = updated.slice(0, dom.start) + "const DOMAIN_DETAILS: Record<string, any> = DOMAIN_DATA" + updated.slice(dom.end)
updated = updated.slice(0, cat.start) + "const CATALOG = CATALOG_DATA" + updated.slice(cat.end)

// Add imports after the shared.js import
updated = updated.replace(
  `import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"`,
  `import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"
import { CATALOG as CATALOG_DATA } from "./agent-catalog-data.js"
import { DOMAIN_DETAILS as DOMAIN_DATA } from "./agent-domain-details.js"`
)

writeFileSync("src/tools/agent-utils.ts", updated, "utf8")

// ── Verify ───────────────────────────────────────────────────────────────
const v = readFileSync("src/tools/agent-utils.ts", "utf8")
console.log("\nVerification:")
console.log("  agent-utils.ts lines:", v.split(/\r?\n/).length)
console.log("  catalog import:", v.includes("agent-catalog-data"))
console.log("  domain import:", v.includes("agent-domain-details"))
console.log("  CATALOG_DATA ref:", v.includes("CATALOG_DATA"))
console.log("  DOMAIN_DATA ref:", v.includes("DOMAIN_DATA"))
console.log("  registerTool calls:", (v.match(/registerTool\(/g) || []).length)

const c = readFileSync("src/tools/agent-catalog-data.ts", "utf8")
console.log("  catalog-data.ts lines:", c.split(/\r?\n/).length)
const d = readFileSync("src/tools/agent-domain-details.ts", "utf8")
console.log("  domain-details.ts lines:", d.split(/\r?\n/).length)
