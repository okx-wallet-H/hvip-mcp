import type { Server as WSServer } from "ws"
import { WebSocketServer, WebSocket } from "ws"

// ── 类型 ──────────────────────────────────────────────────────────────────

interface AgentConn {
  ws: WebSocket
  agentId: string
  name: string
  capabilities: string[]
  status: "idle" | "working"
  lastSeen: number
}

interface TaskState {
  status: "unassigned" | "assigned" | "done" | "reviewed"
  assignedTo?: string
  claimedAt?: number
  result?: string
  branch?: string
}

interface HubMessage {
  type: string
  [key: string]: unknown
}

// ── Hub 核心 ──────────────────────────────────────────────────────────────

class AgentHub {
  private wss: WSServer | null = null
  private agents = new Map<string, AgentConn>()
  private tasks = new Map<string, TaskState>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // ── 启动 ──
  start(port: number, host = "0.0.0.0"): void {
    this.wss = new WebSocketServer({ port, host })
    console.log(`[AgentHub] WS Server started on ws://${host}:${port}`)

    this.wss.on("connection", (ws) => {
      let agentId: string | null = null

      ws.on("message", (raw) => {
        try {
          const msg: HubMessage = JSON.parse(raw.toString())
          this.handleMessage(ws, agentId, msg)
        } catch {
          this.send(ws, { type: "error", message: "消息格式错误：非 JSON" })
        }
      })

      ws.on("close", () => {
        if (agentId) {
          const info = this.agents.get(agentId)
          console.log(`[AgentHub] Agent 离线: ${agentId} (${info?.name || "?"})`)
          this.agents.delete(agentId)
          // 回收未完成的任务
          for (const [tid, t] of this.tasks) {
            if (t.assignedTo === agentId && t.status === "assigned") {
              t.status = "unassigned"
              t.assignedTo = undefined
              t.claimedAt = undefined
              this.broadcast({ type: "task:released", taskId: tid, reason: "Agent 离线" })
            }
          }
        }
      })

      ws.on("error", () => { /* close 事件会处理 */ })
    })

    // 心跳检查：每 30s 踢掉超时 2 分钟的 Agent
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, a] of this.agents) {
        if (now - a.lastSeen > 120_000) {
          a.ws.close()
          this.agents.delete(id)
          console.log(`[AgentHub] Agent 心跳超时: ${id}`)
        }
      }
    }, 30_000)
  }

  // ── 消息路由 ──
  private handleMessage(ws: WebSocket, authAgentId: string | null, msg: HubMessage): void {
    switch (msg.type) {
      case "agent:hello":
        this.handleHello(ws, msg)
        break
      case "agent:status":
        if (authAgentId) this.handleAgentStatus(authAgentId)
        break
      case "task:claim":
        this.handleClaim(msg)
        break
      case "task:done":
        this.handleDone(msg)
        break
      default:
        this.send(ws, { type: "error", message: `未知消息类型: ${msg.type}` })
    }
  }

  // ── Agent 注册 ──
  private handleHello(ws: WebSocket, msg: HubMessage): void {
    const agentId = String(msg.agentId || "")
    const name = String(msg.name || agentId || "Unknown")
    const capabilities = Array.isArray(msg.capabilities) ? msg.capabilities as string[] : []

    if (!agentId) {
      this.send(ws, { type: "error", message: "缺少 agentId" })
      return
    }

    // 踢掉旧连接
    const existing = this.agents.get(agentId)
    if (existing) existing.ws.close()

    this.agents.set(agentId, {
      ws, agentId, name, capabilities,
      status: "idle",
      lastSeen: Date.now(),
    })

    console.log(`[AgentHub] Agent 注册: ${agentId} (${name}) skills: [${capabilities.join(", ")}]`)
    this.send(ws, {
      type: "agent:registered",
      agentId,
      message: `已注册。可用任务: ${this.getUnassignedTasks().join(", ") || "无"}`,
      pendingTasks: this.getUnassignedTasks(),
    })

    // 自动派发匹配的任务
    if (capabilities.length > 0) {
      for (const tid of this.getUnassignedTasks()) {
        if (capabilities.includes(tid)) {
          this.dispatchTaskTo(tid, agentId)
        }
      }
    }
  }

  // ── Agent 心跳 ──
  private handleAgentStatus(agentId: string): void {
    const a = this.agents.get(agentId)
    if (a) {
      a.lastSeen = Date.now()
      this.send(a.ws, { type: "agent:pong" })
    }
  }

  // ── 任务认领 ──
  private handleClaim(msg: HubMessage): void {
    const taskId = String(msg.taskId || "")
    const agentId = String(msg.agentId || "")

    const task = this.tasks.get(taskId)
    if (!task) {
      this.sendTo(agentId, { type: "error", message: `任务 ${taskId} 不存在` })
      return
    }
    if (task.status === "assigned" && task.assignedTo !== agentId) {
      this.sendTo(agentId, { type: "error", message: `任务 ${taskId} 已被 ${task.assignedTo} 认领` })
      return
    }

    task.status = "assigned"
    task.assignedTo = agentId
    task.claimedAt = Date.now()

    const a = this.agents.get(agentId)
    if (a) a.status = "working"

    console.log(`[AgentHub] ${agentId} 认领 ${taskId}`)
    this.sendTo(agentId, {
      type: "task:assigned",
      taskId,
      message: `已认领 ${taskId}。请阅读 tasks/${taskId}.md 开始实现。`,
      url: `https://github.com/okx-wallet-H/hvip-mcp/blob/master/tasks/${taskId}.md`,
    })
    this.broadcast({ type: "agent:update", agentId, status: "working", taskId })
  }

  // ── 任务完成 ──
  private handleDone(msg: HubMessage): void {
    const taskId = String(msg.taskId || "")
    const agentId = String(msg.agentId || "")
    const result = String(msg.result || "")
    const branch = String(msg.branch || "")

    const task = this.tasks.get(taskId)
    if (!task) {
      this.sendTo(agentId, { type: "error", message: `任务 ${taskId} 不存在` })
      return
    }

    task.status = "done"
    task.result = result
    task.branch = branch

    const a = this.agents.get(agentId)
    if (a) a.status = "idle"

    console.log(`[AgentHub] ${agentId} 完成 ${taskId}: ${result}`)
    this.broadcast({
      type: "task:completed",
      taskId, agentId, result, branch,
      message: `${agentId} 已完成 ${taskId}，等待审核`,
    })
  }

  // ── 派发任务到指定 Agent ──
  dispatchTaskTo(taskId: string, agentId: string): void {
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, { status: "unassigned" })
    }
    const task = this.tasks.get(taskId)!
    if (task.status === "assigned") return

    this.sendTo(agentId, {
      type: "task:dispatch",
      taskId,
      title: this.getTaskTitle(taskId),
      url: `https://github.com/okx-wallet-H/hvip-mcp/blob/master/tasks/${taskId}.md`,
    })
  }

  // ── 审核 ──
  reviewTask(taskId: string, verdict: "approved" | "rejected", feedback?: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return

    if (verdict === "approved") {
      task.status = "reviewed"
    } else {
      task.status = "unassigned"
      task.assignedTo = undefined
      task.claimedAt = undefined
    }

    if (task.assignedTo) {
      this.sendTo(task.assignedTo, { type: "task:review", taskId, verdict, feedback })
    }
  }

  // ── 链上事件桥接 ──
  bridgeChainEvent(event: unknown): void {
    this.broadcast({ type: "chain:event", data: event, timestamp: new Date().toISOString() })
  }

  // ── 工具 ──
  private send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  private sendTo(agentId: string, msg: object): void {
    const a = this.agents.get(agentId)
    if (a) this.send(a.ws, msg)
  }

  private broadcast(msg: object): void {
    const raw = JSON.stringify(msg)
    for (const [, a] of this.agents) {
      if (a.ws.readyState === WebSocket.OPEN) a.ws.send(raw)
    }
  }

  private getUnassignedTasks(): string[] {
    return [...this.tasks.entries()]
      .filter(([, t]) => t.status === "unassigned")
      .map(([id]) => id)
  }

  private getTaskTitle(taskId: string): string {
    const titles: Record<string, string> = {
      "T-001": "Outcomes 事件市场查询 (5 端点)",
      "T-002": "Outcomes 市场数据 (3 端点)",
      "T-003": "Outcomes 订单管理 (6 端点, EIP-712)",
      "T-004": "Outcomes 持仓 & 账户 (6 端点)",
      "T-005": "事件合约交易 (5 端点, EVENTS)",
      "T-006": "H Rails /markets 列表 (1 端点)",
    }
    return titles[taskId] || taskId
  }

  // ── 状态快照 ──
  status(): HubStatus {
    const agents = [...this.agents.entries()].map(([id, a]) => ({
      agentId: id,
      name: a.name,
      capabilities: a.capabilities,
      status: a.status,
      lastSeen: new Date(a.lastSeen).toISOString(),
    }))

    const tasks = [...this.tasks.entries()].map(([id, t]) => ({
      taskId: id,
      title: this.getTaskTitle(id),
      status: t.status,
      assignedTo: t.assignedTo,
      claimedAt: t.claimedAt ? new Date(t.claimedAt).toISOString() : undefined,
      result: t.result,
      branch: t.branch,
    }))

    return { agents, tasks, agentCount: agents.length, taskCount: tasks.length }
  }

  // ── 关闭 ──
  close(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    this.wss?.close()
    this.agents.clear()
    this.tasks.clear()
  }
}

interface HubStatus {
  agents: Array<{
    agentId: string
    name: string
    capabilities: string[]
    status: string
    lastSeen: string
  }>
  tasks: Array<{
    taskId: string
    title: string
    status: string
    assignedTo?: string
    claimedAt?: string
    result?: string
    branch?: string
  }>
  agentCount: number
  taskCount: number
}

// 单例
export const agentHub = new AgentHub()
export type { HubStatus }

// 便利函数
export function startAgentHub(port: number, host = "0.0.0.0"): void {
  agentHub.start(port, host)
}
