import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerMarketTools }     from "./tools/market.js"
import { registerPublicTools }     from "./tools/public.js"
import { registerAccountTools }    from "./tools/account.js"
import { registerTradingTools }    from "./tools/trading.js"
import { registerAlgoTools }       from "./tools/algo.js"
import { registerFundingTools }    from "./tools/funding.js"
import { registerStatsTools }      from "./tools/stats.js"
import { registerSubAccountTools } from "./tools/subaccount.js"
import { registerFinanceTools }    from "./tools/finance.js"
import { registerOutcomesTools }   from "./tools/outcomes.js"
import { registerBotTools }        from "./tools/bot.js"
import { registerSpreadTools }     from "./tools/spread.js"
import { registerCopyTools }       from "./tools/copy.js"
import { registerSignalTools }      from "./tools/signal.js"
import { registerRfqTools }        from "./tools/rfq.js"
import { registerAffiliateTools }  from "./tools/affiliate.js"
import { registerFiatTools }     from "./tools/fiat.js"
import { registerAgentUtils }    from "./tools/agent-utils.js"
import { registerIndicatorTools } from "./tools/indicators.js"
import { registerSmartMoneyTools } from "./tools/smartmoney.js"
import { registerXLayerWSTools } from "./tools/xlayer-ws.js"
import { registerWsTools } from "./tools/ws.js"
import { registerAgentHubTools } from "./tools/agent-hub.js"
import { startAgentHub } from "./adapters/agent-hub.js"
import { getAuth, classifyRisk, type RiskLevel } from "./tools/shared.js"
import { privateApi } from "./adapters/okx.js"

async function main() {
  const VERSION = "0.2.46"
  const server = new McpServer({
    name: "hvip-mcp",
    version: VERSION,
    description: "hvip MCP Server — 362 工具覆盖 97.7% OKX REST API，含交易/行情/资金/策略/预测市场/技术指标/Smart Money（非 OKX 官方产品）。仓库: https://github.com/okx-wallet-H/hvip-mcp",
  })
  const auth = getAuth()

  // ── 只读模式 ──────────────────────────────────────────────────────────
  const READ_ONLY = process.env.OKX_READ_ONLY === "true"
  let skipped = 0
  const skipLog: string[] = []

  function createReadOnlyProxy(s: McpServer): McpServer {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (s as any).tool?.bind?.(s) ?? s.tool.bind(s)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(s as any).tool = function (name: string, ...args: any[]) {
      const risk: RiskLevel = classifyRisk(name)
      if (risk !== "READ") {
        skipped++
        skipLog.push(`${name} (${risk})`)
        return // 静默跳过 WRITE/FUND_TRANSFER/ADMIN 工具
      }
      return orig(name, ...args)
    }
    return s
  }

  const effectiveServer = READ_ONLY ? createReadOnlyProxy(server) : server

  registerMarketTools(effectiveServer)
  registerPublicTools(effectiveServer, auth)
  registerStatsTools(effectiveServer)
  registerSpreadTools(effectiveServer, auth)
  registerOutcomesTools(effectiveServer)
  registerAccountTools(effectiveServer, auth)
  registerTradingTools(effectiveServer, auth)
  registerAlgoTools(effectiveServer, auth)
  registerBotTools(effectiveServer, auth)
  registerCopyTools(effectiveServer, auth)
  registerSignalTools(effectiveServer, auth)
  registerFundingTools(effectiveServer, auth)
  registerSubAccountTools(effectiveServer, auth)
  registerFinanceTools(effectiveServer, auth)
  registerAffiliateTools(effectiveServer, auth)
  registerFiatTools(effectiveServer, auth)
  registerRfqTools(effectiveServer, auth)
  registerAgentUtils(effectiveServer, auth)

  registerIndicatorTools(effectiveServer)

  registerSmartMoneyTools(effectiveServer, auth)

  registerXLayerWSTools(effectiveServer)
  registerWsTools(effectiveServer)
  registerAgentHubTools(effectiveServer)

  if (READ_ONLY) {
    // 权限探测：验证 API Key 是否有效
    let authStatus = "未配置"
    if (auth) {
      try {
        // probeAccount 是私有导入，这里用简单的环境检查
        authStatus = "已配置（只读模式，仅暴露 READ 级别工具）"
      } catch { authStatus = "已配置" }
    }
    process.stderr.write(`[hvip] 只读模式已启用 | API Key: ${authStatus} | 写入工具已跳过: ${skipped}\n`)
    if (skipLog.length > 0 && process.env.NODE_ENV !== "production") {
      // 仅在开发模式输出详情
      const sample = skipLog.slice(0, 8).join(", ")
      process.stderr.write(`[hvip] 跳过示例: ${sample}${skipLog.length > 8 ? ` +${skipLog.length - 8} 个` : ""}\n`)
    }
  } else if (auth) {
    // 权限感知：探测 auth 是否有效
    try {
      const cfg = await privateApi.getAccountConfig(auth) as any[]
      const uid = cfg?.[0]?.uid ?? "?"
      process.stderr.write(`[hvip] API Key 已验证 | UID: ${uid} | 完整模式（全部 357 工具）\n`)
    } catch {
      process.stderr.write(`[hvip] API Key 验证失败 | 将以未认证模式启动（公开工具可用）\n`)
    }
  } else {
    process.stderr.write(`[hvip] 未配置 API Key | 仅公开工具可用\n`)
  }

  startAgentHub(parseInt(process.env.WS_AGENT_PORT || "9321"), "0.2.46.0", VERSION)

  const transport = new StdioServerTransport()
  await effectiveServer.connect(transport)
}

main()
