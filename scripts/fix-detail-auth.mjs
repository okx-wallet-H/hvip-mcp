import { readFileSync, writeFileSync } from "node:fs"

// Auth-required domains (same as CATALOG)
const AUTH_REQUIRED = new Set([
  "账户资产", "下单交易", "风险风控", "盈亏复盘",
  "资金管理", "策略交易", "聪明钱", "预测市场",
])

let src = readFileSync("src/tools/agent-utils.ts", "utf8")

// 1) Add authRequired to each domain entry in DOMAIN_DETAILS
// Pattern: "domainName": { workflow: "...",
const re = /("[一-鿿\w]+"):\s*\{\s*(\n\s*workflow:)/g
let authCount = 0
src = src.replace(re, (m, domainQuoted, rest) => {
  const domain = JSON.parse(domainQuoted)
  const ar = AUTH_REQUIRED.has(domain)
  authCount++
  return `${domainQuoted}: { authRequired: ${ar},${rest}`
})
console.log(`Added authRequired to ${authCount} DOMAIN_DETAILS entries`)

// 2) Update the agent_catalog_detail response handler
const oldHandler = `        const detail = DOMAIN_DETAILS[domain]
        if (!detail) {
          return toResult({
            found: false,
            domain,
            availableDomains: Object.keys(DOMAIN_DETAILS),
            hint: "请从 availableDomains 中选择一个域，或调 agent_catalog 查看完整导航",
            tsIso: new Date().toISOString(),
          })
        }
        return toResult({
          found: true,
          domain,
          ...detail,
          tsIso: new Date().toISOString(),
        })`

const newHandler = `        const detail = DOMAIN_DETAILS[domain]
        const hasAuth = auth !== null
        if (!detail) {
          return toResult({
            found: false,
            domain,
            availableDomains: Object.keys(DOMAIN_DETAILS),
            hint: "请从 availableDomains 中选择一个域，或调 agent_catalog 查看完整导航",
            tsIso: new Date().toISOString(),
          })
        }
        const needsKey = detail.authRequired && !hasAuth
        return toResult({
          found: true,
          domain,
          authRequired: detail.authRequired,
          keyAvailable: hasAuth,
          usable: !detail.authRequired || hasAuth,
          _authWarning: needsKey ? \`⚠️ 此域需要 API Key，当前未配置。告诉用户去 OKX 官网创建 Key 后重连。\` : null,
          ...detail,
          tsIso: new Date().toISOString(),
        })`

if (src.includes(oldHandler)) {
  src = src.replace(oldHandler, newHandler)
  console.log("Handler updated")
} else {
  console.log("ERROR: old handler not found")
  process.exit(1)
}

// 3) Update the tool description to include auth context
const oldDesc = "域详情\n## 关联：agent_catalog 选域 → 本工具获取详情 → 直接调用目标工具\""
const newDesc = "域详情，并告知此域是否需要 API Key、当前 Key 是否可用\n## 关联：agent_catalog 选域 → 本工具获取详情（含鉴权状态） → 直接调用目标工具\""
src = src.replace(oldDesc, newDesc)

writeFileSync("src/tools/agent-utils.ts", src, "utf8")
console.log("Done")
