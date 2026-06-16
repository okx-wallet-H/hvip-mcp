import "dotenv/config"
import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
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
import { registerCodeGraphTools } from "./tools/codegraph.js"
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

function printHelpAndExit(version: string): never {
  process.stdout.write([
    ``,
    `  hvip-mcp v${version} — OKX MCP 服务器（非 OKX 官方产品）`,
    ``,
    `  🔗 仓库: https://github.com/okx-wallet-H/hvip-mcp`,
    ``,
    `  ⚠️  这不是命令行工具，而是 MCP (Model Context Protocol) 服务器。`,
    `  你不能直接在终端里运行它——需要配置到 MCP 客户端（Claude Desktop、VS Code、Cline 等）中。`,
    ``,
    `  ── 快速开始 ──────────────────────────────────────────────`,
    ``,
    `  Claude Desktop（推荐）:`,
    `    1. 打开 Claude Desktop → 设置 → Developer → Edit Config`,
    `    2. 在 mcpServers 中添加:`,
    ``,
    `       {`,
    `         "hvip": {`,
    `           "command": "npx",`,
    `           "args": ["-y", "hvip-mcp-server"]`,
    `         }`,
    `       }`,
    ``,
    `  VS Code / Cline:`,
    `    在 MCP 配置中添加同样的 JSON。`,
    ``,
    `  ── 可用参数 ──────────────────────────────────────────────`,
    ``,
    `  npx hvip-mcp-server              启动 MCP stdio 服务器`,
    `  npx hvip-mcp-server start:http   启动 HTTP 模式 (localhost:3000)`,
    `  npx hvip-mcp-server --help       显示此帮助`,
    `  npx hvip-mcp-server --version    显示版本号`,
    ``,
    `  ── 环境变量 ──────────────────────────────────────────────`,
    ``,
    `  OKX_API_KEY       API Key（获取：OKX 官网 → 个人中心 → API）`,
    `  OKX_SECRET_KEY     Secret Key`,
    `  OKX_PASSPHRASE     Passphrase`,
    `  PORT=3000          HTTP 模式端口（默认 3000）`,
    `  HOST=127.0.0.1     HTTP 模式绑定地址`,
    ``,
  ].join("\n") + "\n")
  process.exit(0)
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
      const desc = typeof args[0] === "string" ? args[0] : name
      const risk: RiskLevel = classifyRisk(desc)
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
  registerWsTools(server, auth)
  registerAgentHubTools(server)
  registerCodeGraphTools(server)

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
  const host = process.env.HOST || "127.0.0.1"
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

    // ── GET / (chat UI) ──
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      try {
        // Try multiple path resolutions (dev vs published npm)
        const paths = [
          join(__dirname, "web", "index.html"),   // published npm (dist/index.js → dist/web/)
          join(__dirname, "..", "src", "web", "index.html"), // dev (dist/index.js → ../src/web/)
        ]
        let html = ""
        for (const p of paths) { if (existsSync(p)) { html = readFileSync(p, "utf-8"); break } }
        if (!html) throw new Error("file not found")
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(html)
      } catch {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end("<html><body style='font-family:sans-serif;text-align:center;margin-top:60px'><h2>hvip Chat UI 未找到</h2><p>请访问 <a href='/mcp'>/mcp</a> 使用 API</p></body></html>")
      }
      return
    }

    // ── GET /config ──
    if (req.method === "GET" && req.url === "/config") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        claudeApiKey: process.env.CLAUDE_API_KEY || "",
      }))
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

  httpServer.listen(port, host, () => {
    const chatUrl = `http://${host}:${port}`
    process.stderr.write([
      `╔══════════════════════════════════════════════╗`,
      `║  hvip-mcp v${version}  HTTP 模式             ║`,
      `║  🤖 Chat UI → ${chatUrl}         ║`,
      `║  📡 MCP API → ${chatUrl}/mcp                ║`,
      `║  ❤️  health  → ${chatUrl}/health              ║`,
      `║  模式: ${readOnly ? "只读" : "完整"}  | 工具: ${readOnly ? "READ only" : "全部"}  ║`,
      `╚══════════════════════════════════════════════╝`,
    ].join("\n") + "\n")

    // 自动打开浏览器
    const openUrl = `http://127.0.0.1:${port}`
    const platform = process.platform
    const cmd = platform === "win32"
      ? `start ${openUrl}`
      : platform === "darwin"
        ? `open ${openUrl}`
        : `xdg-open ${openUrl}`
    import("node:child_process").then(cp => {
      cp.exec(cmd, () => { /* 忽略错误 */ })
    })
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

  const wsHost = process.env.WS_BIND_HOST || "127.0.0.1"
  startAgentHub(parseInt(process.env.WS_AGENT_PORT || "9321"), wsHost, version)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const VERSION = "0.2.57"

  // ── CLI 标志（在 MCP 握手之前处理） ──
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) printHelpAndExit(VERSION)
  if (argv.includes("--version") || argv.includes("-v")) { process.stdout.write(`hvip-mcp v${VERSION}\n`); process.exit(0) }

  const auth = getAuth()
  const mode = resolveTransportMode()

  // 执行模式: 无 Key 时自动只读
  const exec = resolveExecutionMode()
  const readOnly = exec.readOnly || !auth // 无 Key → 自动只读

  const server = new McpServer({
    name: "hvip-mcp",
    version: VERSION,
    description: "hvip MCP Server — 365 工具覆盖 97.7% OKX REST API，含交易/行情/资金/策略/预测市场/技术指标/Smart Money/WebSocket/代码图谱（非 OKX 官方产品）。仓库: https://github.com/okx-wallet-H/hvip-mcp",
  })

  const { skipped, skipLog } = registerAllTools(server, auth, readOnly)

  if (mode === "http") {
    await startHttp(server, VERSION, auth, readOnly, skipped)
  } else {
    // TTY 检测: 用户直接在终端运行了 hvip-mcp，而不是通过 MCP 客户端
    if (process.stdin.isTTY && process.env.NODE_ENV !== "production") {
      process.stderr.write("\n[hint] 检测到你在终端直接运行 hvip-mcp。\n")
      process.stderr.write("[hint] hvip-mcp 是 MCP 服务器，需要在 MCP 客户端（如 Claude Desktop）中配置。\n")
      process.stderr.write("[hint] 运行 npx hvip-mcp-server --help 查看配置方法。\n\n")
    }
    await startStdio(server, VERSION, auth, readOnly, skipped, skipLog)
  }
}

main()
