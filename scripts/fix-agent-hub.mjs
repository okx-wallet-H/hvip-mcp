import { readFileSync, writeFileSync } from "node:fs"

let s = readFileSync("src/adapters/agent-hub.ts", "utf8")

// Find: setupHub() call position
const marker = 'setupHub()\r\n    })'
const idx = s.indexOf(marker)
if (idx < 0) { console.log('marker not found'); process.exit(1) }
const afterMarker = idx + marker.length

// Find the old floating code
const floatingStart = s.indexOf('    // 预设房间', afterMarker)
const floatingEnd = s.indexOf('  // ── 消息路由 ──', floatingStart)
console.log('floating at:', floatingStart, '-', floatingEnd)

if (floatingStart < 0 || floatingEnd < 0) {
  console.log('bounds not found')
  process.exit(1)
}

// Build new setupHub method
const m = [
  '  private setupHub(): void {',
  '    if (!this.wss) return',
  '    this.ensureRoom("#lobby")',
  '    this.ensureRoom("#review")',
  '    this.wss.on("connection", (ws) => {',
  '      let agentId: string | null = null',
  '      ws.on("message", (raw) => {',
  '        try {',
  '          const msg: HubMessage = JSON.parse(raw.toString())',
  '          this.handleMessage(ws, agentId, msg)',
  '        } catch {',
  '          this.send(ws, { type: "error", message: "消息格式错误：非 JSON" })',
  '        }',
  '      })',
  '      ws.on("close", () => {',
  '        if (agentId) this.handleDisconnect(agentId)',
  '      })',
  '      ws.on("error", () => {})',
  '    })',
  '    this.heartbeatTimer = setInterval(() => {',
  '      const now = Date.now()',
  '      for (const [id, a] of this.agents) {',
  '        if (now - a.lastSeen > 120_000) {',
  '          a.ws.close()',
  '          this.agents.delete(id)',
  '          console.log("[AgentHub] Agent 心跳超时: " + id)',
  '        }',
  '      }',
  '    }, 30_000)',
  '  }',
  '',
  '',
].join('\r\n')

// Replace: remove floating code, insert setupHub method before handleMessage
s = s.slice(0, floatingStart) + m + s.slice(floatingEnd)

writeFileSync("src/adapters/agent-hub.ts", s, "utf8")
console.log("Done")

// Verify
const v = readFileSync("src/adapters/agent-hub.ts", "utf8")
console.log("setupHub() method:", v.includes("private setupHub()"))
console.log("this.setupHub() call:", v.includes("this.setupHub()"))
console.log("floating setup removed:", !v.includes("\n    // 预设房间"))
