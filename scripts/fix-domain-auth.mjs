import { readFileSync, writeFileSync } from "node:fs"

const AUTH_DOMAINS = new Set([
  "账户资产", "下单交易", "风险风控", "盈亏复盘",
  "资金管理", "策略交易", "聪明钱", "预测市场",
])

let s = readFileSync("src/tools/agent-domain-details.ts", "utf8")

// Pattern: "domainName": {\n      workflow: "..."
// Add authRequired before workflow
let count = 0
const re = /("[^"]+"):\s*\{\s*\n\s*(workflow:)/g
s = s.replace(re, (m, name, wf) => {
  const domain = JSON.parse(name)
  const ar = AUTH_DOMAINS.has(domain)
  count++
  return `${name}: { authRequired: ${ar},\n      ${wf}`
})

writeFileSync("src/tools/agent-domain-details.ts", s, "utf8")
console.log(`Added authRequired to ${count} domain entries (${AUTH_DOMAINS.size} required key)`)
