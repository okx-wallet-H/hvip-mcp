import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
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

type TransportMode = "stdio" | "http"

// ═══════════════════════════════════════════════════════════════════════════
// 执行模式决议
// ═══════════════════════════════════════════════════════════════════════════

function resolveExecutionMode(): { readOnly: boolean; reason: string } {
  // 1) MCP_EXECUTION_ENABLED=false — 最高优先级，强制只读
  if (process.env.MCP_EXECUTION_ENABLED === "false") {
    return { readOnly: true, reason: "MCP_EXECUTION_ENABLED=false" }
  }
  // 2) OKX_READ_ONLY=true 或 MCP_READONLY_MODE=true
  if (process.env.OKX_READ_ONLY === "true" || process.env.MCP_READONLY_MODE === "true") {
    return { readOnly: true, reason: "只读模式已启用 (OKX_READ_ONLY / MCP_READONLY_MODE)" }
  }
  // 3) 完整模式
  return { readOnly: false, reason: "" }
}

function resolveTransportMode(): TransportMode {
  const argv = process.argv.slice(2)
  const arg = argv[0] || ""
  if (arg === "start:http") return "http"
  if (arg === "start:stdio" || arg === "" || arg.startsWith("-")) return "stdio"
  // 向后兼容: 不认识的参数仍用 stdio
  return "stdio"
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具注册
// ═══════════════════════════════════════════════════════════════════════════

function registerAllTools(
  server: McpServer,
  auth: ReturnType<typeof getAuth>,
  readOnly: boolean,
): { skipped: number; skipLog: string[] } {
  let skipped = 0
  const skipLog: string[] = []

  if (readOnly) {
    // Proxy 拦截: 所有非 READ 工具静默跳过
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (server as any).tool.bind(server)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(server as any).tool = function (name: string, ...args: any[]) {
      const risk: RiskLevel = classifyRisk(name)
      if (risk !== "READ") {
        skipped++
        skipLog.push(`${name} (${risk})`)
        return // 跳过
      }
      return orig(name, ...args)
    }
  }

  registerMarketTools(server)
  registerPublicTools(server, auth)
  registerStatsTools(server)
  registerSpreadTools(server, auth)
  registerOutcomesTools(server)
  registerAccountTools(server, auth)
  registerTradingTools(server, auth)
  registerAlgoTools(server, auth)
  registerBotTools(server, auth)
  registerCopyTools(server, auth)
  registerSignalTools(server, auth)
  registerFundingTools(server, auth)
  registerSubAccountTools(server, auth)
  registerFinanceTools(server, auth)
  registerAffiliateTools(server, auth)
  registerFiatTools(server, auth)
  registerRfqTools(server, auth)
  registerAgentUtils(server, auth)
  registerIndicatorTools(server)
  registerSmartMoneyTools(server, auth)
  registerXLayerWSTools(server)
  registerWsTools(server)
  registerAgentHubTools(server)

  return { skipped, skipLog }
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP 模式
// ═══════════════════════════════════════════════════════════════════════════

async function startHttp(
  server: McpServer,
  version: string,
  auth: ReturnType<typeof getAuth>,
  readOnly: boolean,
  skipped: number,
) {
  const port = parseInt(process.env.PORT || "3000", 10)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  })

  await server.connect(transport)

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    // ── GET /health ──
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        status: "ok",
        name: "hvip-mcp",
        version,
        mode: readOnly ? "read-only" : "full",
        auth: !!auth,
        skippedTools: skipped,
        uptime: process.uptime(),
        tsIso: new Date().toISOString(),
      }))
      return
    }

    // ── POST /mcp ──
    if (req.method === "POST" && req.url === "/mcp") {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", async () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8")
          const parsed = body ? JSON.parse(body) : undefined
          await transport.handleRequest(req, res, parsed)
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }))
        }
      })
      return
    }

    // ── 其他 → 404 ──
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  httpServer.listen(port, "0.0.0.0", () => {
    process.stderr.write([
      `╔══════════════════════════════════════════════╗`,
      `║  hvip-mcp v${version}  HTTP 模式             ║`,
      `║  POST http://0.0.0.0:${port}/mcp              ║`,
      `║  GET  http://0.0.0.0:${port}/health            ║`,
      `║  模式: ${readOnly ? "只读" : "完整"}  | 工具: ${readOnly ? "READ only" : "全部"}  ║`,
      `╚══════════════════════════════════════════════╝`,
    ].join("\n") + "\n")
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Stdio 模式
// ═══════════════════════════════════════════════════════════════════════════

async function startStdio(
  server: McpServer,
  version: string,
  auth: ReturnType<typeof getAuth>,
  readOnly: boolean,
  skipped: number,
  skipLog: string[],
) {
  if (readOnly) {
    const authStatus = auth ? "已配置（仅 READ 工具）" : "未配置"
    process.stderr.write(`[hvip] 只读模式 | API Key: ${authStatus} | 跳过 ${skipped} 个非 READ 工具\n`)
    if (skipLog.length > 0 && process.env.NODE_ENV !== "production") {
      const sample = skipLog.slice(0, 8).join(", ")
      process.stderr.write(`[hvip] 跳过: ${sample}${skipLog.length > 8 ? ` +${skipLog.length - 8}` : ""}\n`)
    }
  } else if (auth) {
    try {
      const cfg = await privateApi.getAccountConfig(auth) as any[]
      const uid = cfg?.[0]?.uid ?? "?"
      process.stderr.write(`[hvip] API Key 已验证 | UID: ${uid} | 完整模式 (v${version})\n`)
    } catch {
      process.stderr.write(`[hvip] API Key 验证失败 | 降级为未认证模式\n`)
    }
  } else {
    process.stderr.write(`[hvip] 未配置 API Key | 仅公开工具可用 (v${version})\n`)
  }

  startAgentHub(parseInt(process.env.WS_AGENT_PORT || "9321"), "0.0.0.0", version)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const VERSION = "0.2.46"
  const auth = getAuth()
  const mode = resolveTransportMode()

  // 执行模式: 无 Key 时自动只读
  const exec = resolveExecutionMode()
  const readOnly = exec.readOnly || !auth // 无 Key → 自动只读

  const server = new McpServer({
    name: "hvip-mcp",
    version: VERSION,
    description: "hvip MCP Server — 362 工具覆盖 97.7% OKX REST API，含交易/行情/资金/策略/预测市场/技术指标/Smart Money（非 OKX 官方产品）。仓库: https://github.com/okx-wallet-H/hvip-mcp",
  })

  const { skipped, skipLog } = registerAllTools(server, auth, readOnly)

  if (mode === "http") {
    await startHttp(server, VERSION, auth, readOnly, skipped)
  } else {
    await startStdio(server, VERSION, auth, readOnly, skipped, skipLog)
  }
}

main()
