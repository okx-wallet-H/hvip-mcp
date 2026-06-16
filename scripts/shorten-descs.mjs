import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = "src/tools"
const skip = new Set(["agent-utils.ts","codegraph.ts","shared.ts"])

let totalFiles = 0, totalTools = 0

for (const f of readdirSync(dir).filter(x => x.endsWith(".ts"))) {
  if (skip.has(f)) continue
  const fp = join(dir, f)
  let src = readFileSync(fp, "utf8")
  let changed = false

  // Find all server.tool(...) calls. The description is the second argument.
  // Pattern: server.tool(\n  "NAME",\n  "LONG_DESC",\n  ...
  const re = /(server\.tool\(\s*\n?\s*"[^"]+",\s*\n?\s*)"((?:[^"\\]|\\.)*CAT:\[[^\]]+\](?:[^"\\]|\\.)*)"/g

  src = src.replace(re, (_, prefix, desc) => {
    // Extract CAT:[category] from the description
    const catMatch = desc.match(/CAT:\[([^\]]+)\]/)
    const category = catMatch ? catMatch[1] : "工具"
    totalTools++
    return prefix + '"CAT:[' + category + '] | → 请先调用 agent_catalog"'
  })

  if (src !== readFileSync(fp, "utf8")) {
    writeFileSync(fp, src, "utf8")
    totalFiles++
    console.log(f + ": done")
  }
}

console.log("\ntotal: " + totalFiles + " files, " + totalTools + " tools")
