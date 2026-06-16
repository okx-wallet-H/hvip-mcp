import { readFileSync, writeFileSync } from "node:fs"

let src = readFileSync("src/tools/agent-utils.ts", "utf8")

const oldBlock = `        // ── go_to 工具参数提示，Agent 无需再查 tools/list ──
        const paramsHints: Record<string, string> = {`

const newBlock = `        const publicDomains = CATALOG.domains.filter((d: any) => !d.authRequired)
        const authDomains   = CATALOG.domains.filter((d: any) => d.authRequired)

        return toResult({
          tsIso: new Date().toISOString(),
          _setup: setup,
          _onboarding: onboarding,
          _instruction: CATALOG._instruction,
          publicDomains,
          authDomains: hasAuth ? authDomains : authDomains.map((d: any) => ({ ...d, _disabled: "需要配置 API Key 后才能使用此域" })),
          _tips: CATALOG._tips,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_catalog_detail`

const oldEnd = `      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_catalog_detail`

// Find start
const startIdx = src.indexOf(oldBlock)
if (startIdx < 0) { console.log("ERROR: old block not found"); process.exit(1) }

// Find end
const endIdx = src.indexOf(oldEnd, startIdx)
if (endIdx < 0) { console.log("ERROR: old end not found"); process.exit(1) }
const endPos = endIdx + oldEnd.length

console.log("Start:", startIdx, "End:", endPos)
console.log("Old block length:", endPos - startIdx)

src = src.slice(0, startIdx) + newBlock + src.slice(endPos)
writeFileSync("src/tools/agent-utils.ts", src, "utf8")

// Verify
const verify = readFileSync("src/tools/agent-utils.ts", "utf8")
console.log("publicDomains:", verify.includes("publicDomains"))
console.log("authDomains:", verify.includes("authDomains"))
console.log("_disabled:", verify.includes("_disabled"))
console.log("paramsHints removed:", !verify.includes("paramsHints"))
console.log("enrichedDomains removed:", !verify.includes("enrichedDomains"))
console.log("catalog_detail still there:", verify.includes("agent_catalog_detail"))
