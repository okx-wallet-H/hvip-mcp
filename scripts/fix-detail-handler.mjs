import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("src/tools/agent-utils.ts", "utf8");

const old = /const detail = DOMAIN_DETAILS\[domain\]\r?\n\s*if \(!detail\) \{[\s\S]*?return toResult\(\{[\s\S]*?found: true,[\s\S]*?\.\.\.detail,[\s\S]*?tsIso: new Date\(\)\.toISOString\(\),\r?\n\s*\}\)/;
const m = s.match(old);
if (!m) { console.log('NOT MATCHED'); process.exit(1); }

const n = `const detail = DOMAIN_DETAILS[domain]
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
          _authWarning: needsKey ? "⚠️ 此域需要 API Key，当前未配置。告诉用户去 OKX 官网创建 Key 后重连。" : null,
          ...detail,
          tsIso: new Date().toISOString(),
        })`;

s = s.replace(m[0], n);
writeFileSync("src/tools/agent-utils.ts", s, "utf8");
console.log("Handler replaced OK");
