/**
 * Agent Hub 独立服务器
 *
 * 不依赖 MCP server，可 7×24 守护运行。
 * 持久化 tasks + messages 到 SQLite，重启不丢状态。
 *
 * Usage:
 *   npx tsx src/hub-server.ts
 *   npx tsx src/hub-server.ts --port 9321 --host 0.0.0.0 --db .hub/data.db
 *
 * PM2:
 *   pm2 start dist/hub-server.js --name hvip-hub
 */

import { agentHub } from "./adapters/agent-hub.js"
import { HubDB } from "./adapters/hub-persistence.js"

const VERSION = "0.3.0"

// ── CLI 参数 ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = argv.indexOf("--" + name)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  return undefined
}

function flagBool(name: string): boolean {
  return argv.includes("--" + name)
}

const port = parseInt(flag("port") || process.env.HUB_PORT || "9321", 10)
const host = flag("host") || process.env.HUB_HOST || "127.0.0.1"
const dbPath = flag("db") || process.env.HUB_DB_PATH || ".hub/hub.db"

// ── 启动 ──────────────────────────────────────────────────────────────────

const portStr = String(port)
const banner = [
  `╔══════════════════════════════════════════════════╗`,
  `║  🤖 Agent Hub v${VERSION}  独立服务器              ║`,
  `║  📡 ws://${host}:${portStr.padEnd(37)}║`,
  `║  💾 ${dbPath.padEnd(42)}║`,
  `╚══════════════════════════════════════════════════╝`,
].join("\n")

process.stderr.write(banner + "\n")

// 持久化
const db = new HubDB(dbPath)
if (db.open()) {
  agentHub.setDB(db)

  const stats = db.stats()
  process.stderr.write(`[Hub] DB 状态: ${stats.taskCount} tasks, ${stats.messageCount} messages\n`)
}

// 启动 WebSocket Hub
agentHub.start(port, host, VERSION)

// ── 优雅退出 ──────────────────────────────────────────────────────────────

function shutdown() {
  process.stderr.write("\n[Hub] 正在关闭...\n")
  agentHub.close()
  db.close()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// ── 保活 ──────────────────────────────────────────────────────────────────

// 防止 Node 因无活跃连接而退出
const keepAlive = setInterval(() => {}, 60_000)
process.on("exit", () => clearInterval(keepAlive))

export {}
