import { readFileSync, writeFileSync } from "node:fs"

const files = {
  "src/tools/trading.ts": "CAT:[交易] | → 请先调用 agent_catalog",
  "src/tools/rfq.ts": "CAT:[策略-RFQ] | → 请先调用 agent_catalog",
  "src/tools/public.ts": "CAT:[公共] | → 请先调用 agent_catalog",
  "src/tools/account.ts": "CAT:[账户] | → 请先调用 agent_catalog",
}

let total = 0
for (const [fp, newDesc] of Object.entries(files)) {
  let src = readFileSync(fp, "utf8")
  let count = 0

  // Match: registerTool(\n    server,\n    "NAME",\n    "LEVEL",\n    `OLD DESC...`
  // Replace the backtick desc with the short CAT: desc
  src = src.replace(
    /(registerTool\(\s*\n\s*server,\s*\n\s*"[^"]+",\s*\n\s*"[^"]+",\s*\n\s*)`[^`]*`/g,
    (m, prefix) => {
      count++
      return prefix + '"' + newDesc + '"'
    }
  )

  if (count > 0) {
    writeFileSync(fp, src, "utf8")
    console.log(fp + ": " + count + " tools fixed")
    total += count
  }
}

console.log("\nTotal: " + total + " old descs → CAT short format")
