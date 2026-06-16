import type { Server as WSServer } from "ws"
import { WebSocketServer, WebSocket } from "ws"
import type { HubDB } from "./hub-persistence.js"

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

// ── Room ──────────────────────────────────────────────────────────────────

interface RoomMessage {
  roomId: string
  from:    string
  text:    string
  ts:      string
}

interface RoomState {
  messages: RoomMessage[]
  members:  Set<string>
}

const MAX_ROOM_MESSAGES = 200

// ── Hub 核心 ──────────────────────────────────────────────────────────────

class AgentHub {
  private wss: WSServer | null = null
  private agents = new Map<string, AgentConn>()
  private tasks = new Map<string, TaskState>()
  private rooms = new Map<string, RoomState>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private version = "0.0.0"
  private port = 0
  private db: HubDB | null = null

  // ── 持久化绑定 ──

  setDB(db: HubDB): void {
    this.db = db
    // 从 DB 恢复任务
    const rows = db.loadTasks()
    for (const r of rows) {
      this.tasks.set(r.taskId, {
        status: r.status as TaskState["status"],
        assignedTo: r.assignedTo || undefined,
        claimedAt: r.claimedAt || undefined,
        result: r.result || undefined,
        branch: r.branch || undefined,
      })
    }
    if (rows.length > 0) {
      console.log(`[AgentHub] 从 DB 恢复 ${rows.length} 个任务`)
    }
  }

  // ── 启动 ──
  start(port: number, host = "0.0.0.0", version = "0.0.0"): void {
    this.version = version
    const startWss = (p: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const wss = new WebSocketServer({ port: p, host })
        let resolved = false
        const done = (ok: boolean) => { if (!resolved) { resolved = true; resolve(ok) } }
        wss.on("listening", () => {
          this.wss = wss
          this.port = p
          done(true)
        })
        wss.on("error", () => {
          try { wss.close() } catch {}
          done(false)
        })
        // 超时 1s 判定失败
        setTimeout(() => done(false), 1000)
      })
    }
    // 异步尝试端口，不阻塞 MCP 启动
    const ports = [port, port + 1, port + 2]
    startWss(ports[0]).then(ok => {
      if (!ok) return startWss(ports[1])
      return true
    }).then(ok => {
      if (!ok) return startWss(ports[2])
      return ok === true ? true : false
    }).then(ok => {
      if (!ok) {
        process.stderr.write(`[AgentHub] WS Hub 跳过（端口 ${ports.join("/")} 不可用）\n`)
        return
      }
      process.stderr.write(`[AgentHub] WS Hub v${version} ws://${host}:${this.port}\n`)
      this.setupHub()
    })
  }

  private setupHub(): void {
    if (!this.wss) return
    this.ensureRoom("#lobby")
    this.ensureRoom("#review")
    this.wss.on("connection", (ws) => {
      let agentId: string | null = null
      ws.on("message", (raw) => {
        try {
          const msg: HubMessage = JSON.parse(raw.toString())
          const newId = this.handleMessage(ws, agentId, msg)
          if (newId) agentId = newId
        } catch {
          this.send(ws, { type: "error", message: "消息格式错误：非 JSON" })
        }
      })
      ws.on("close", () => {
        if (agentId) this.handleDisconnect(agentId)
      })
      ws.on("error", () => {})
    })
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, a] of this.agents) {
        if (now - a.lastSeen > 120_000) {
          a.ws.close()
          this.agents.delete(id)
          console.log("[AgentHub] Agent 心跳超时: " + id)
        }
      }
    }, 30_000)
  }

  // ── 消息路由 ──
  private handleMessage(ws: WebSocket, authAgentId: string | null, msg: HubMessage): string | null {
    switch (msg.type) {
      case "agent:hello":   return this.handleHello(ws, msg);
      case "agent:status":  if (authAgentId) this.handleAgentStatus(authAgentId); break
      case "task:claim":    this.handleClaim(msg); break
      case "task:done":     this.handleDone(msg); break
      // ── Room ──
      case "room:join":     this.handleRoomJoin(authAgentId, msg); break
      case "room:leave":    this.handleRoomLeave(authAgentId, msg); break
      case "room:message":  this.handleRoomMessage(authAgentId, msg); break
      case "room:history":  this.handleRoomHistory(ws, msg); break
      default:
        this.send(ws, { type: "error", message: `未知消息类型: ${msg.type}` })
    }
    return null
  }

  // ── Agent 注册 ──
  private handleHello(ws: WebSocket, msg: HubMessage): string {
    const agentId = String(msg.agentId || "")
    const name = String(msg.name || agentId || "Unknown")
    const capabilities = Array.isArray(msg.capabilities) ? msg.capabilities as string[] : []

    if (!agentId) {
      this.send(ws, { type: "error", message: "缺少 agentId" })
      return ""
    }

    const existing = this.agents.get(agentId)
    if (existing) existing.ws.close()

    this.agents.set(agentId, {
      ws, agentId, name, capabilities,
      status: "idle",
      lastSeen: Date.now(),
    })

    // 自动推入 #lobby
    this.joinRoom(agentId, "#lobby")

    console.log(`[AgentHub] Agent 注册: ${agentId} (${name}) skills: [${capabilities.join(", ")}]`)
    this.send(ws, {
      type: "agent:registered",
      agentId,
      currentVersion: this.version,
      message: `已注册。可用任务: ${this.getUnassignedTasks().join(", ") || "无"}`,
      pendingTasks: this.getUnassignedTasks(),
    })

    // 版本检查：Agent 落后自动提醒升级
    const agentVersion = String(msg.version || "")
    if (agentVersion && agentVersion !== this.version) {
      this.send(ws, {
        type: "agent:upgrade",
        current: this.version,
        yourVersion: agentVersion,
        message: `hvip MCP 已升级到 v${this.version}，你当前 v${agentVersion}。请 git pull && npm run build 后重连。`,
      })
      this.sendToRoom("#lobby", "system", `${agentId} 版本过旧 (v${agentVersion})，已提醒升级到 v${this.version}`)
    }

    // 自动派发匹配的任务
    if (capabilities.length > 0) {
      for (const tid of this.getUnassignedTasks()) {
        if (capabilities.includes(tid)) {
          this.dispatchTaskTo(tid, agentId)
        }
      }
    }
    return agentId
  }

  private handleDisconnect(agentId: string): void {
    const info = this.agents.get(agentId)
    console.log(`[AgentHub] Agent 离线: ${agentId} (${info?.name || "?"})`)

    // 离开所有房间
    for (const [roomId, room] of this.rooms) {
      if (room.members.has(agentId)) {
        room.members.delete(agentId)
        this.sendToRoomMembers(room, {
          type: "room:member_left",
          roomId,
          agentId,
        })
      }
    }
    this.agents.delete(agentId)

    // 回收任务
    for (const [tid, t] of this.tasks) {
      if (t.assignedTo === agentId && t.status === "assigned") {
        t.status = "unassigned"
        t.assignedTo = undefined
        t.claimedAt = undefined
        this.db?.saveTask({ taskId: tid, status: "unassigned" })
        this.broadcast({ type: "task:released", taskId: tid, reason: "Agent 离线" })
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

    // 自动推入任务房间
    this.joinRoom(agentId, `#task-${taskId}`)

    console.log(`[AgentHub] ${agentId} 认领 ${taskId}`)
    this.db?.saveTask({ taskId, status: "assigned", title: this.getTaskTitle(taskId), assignedTo: agentId, claimedAt: task.claimedAt })
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
    this.db?.saveTask({ taskId, status: "done", title: this.getTaskTitle(taskId), assignedTo: agentId, result, branch })

    // 发到任务房间
    this.sendToRoom(`#task-${taskId}`, agentId, `已完成 ${taskId}: ${result} (branch: ${branch})，等待审核。`)
    // 发到审核房间
    this.sendToRoom("#review", agentId, `${taskId} 提交完成，branch: ${branch}`)

    this.broadcast({
      type: "task:completed",
      taskId, agentId, result, branch,
      message: `${agentId} 已完成 ${taskId}，等待审核`,
    })
  }

  // ── 注册任务（不派发，仅登记） ──
  registerTask(taskId: string, title?: string): void {
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, { status: "unassigned" })
    }
    // 记录到自定义标题
    if (title) {
      const t = this.tasks.get(taskId)!
      ;(t as any).title = title
    }
    console.log(`[AgentHub] 任务注册: ${taskId} "${title || taskId}"`)
  }

  // ── 派发任务 ──
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

  // ── 审核 + 自动通知房间 ──
  reviewTask(taskId: string, verdict: "approved" | "rejected", feedback?: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return

    if (verdict === "approved") {
      task.status = "reviewed"
      this.db?.saveTask({ taskId, status: "reviewed", reviewedAt: new Date().toISOString() })
    } else {
      task.status = "unassigned"
      task.assignedTo = undefined
      task.claimedAt = undefined
      this.db?.saveTask({ taskId, status: "unassigned" })
    }

    const roomId = `#task-${taskId}`
    const msg = verdict === "approved"
      ? `✅ ${taskId} 审核通过。已合并到 master 并删除远程分支。`
      : `❌ ${taskId} 审核不通过。${feedback || "请修改后重新 push。"}`

    this.sendToRoom(roomId, "reviewer", msg)
    this.sendToRoom("#review", "reviewer", `${taskId}: ${verdict}`)

    if (task.assignedTo) {
      this.sendTo(task.assignedTo, { type: "task:review", taskId, verdict, feedback })
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Room 操作
  // ══════════════════════════════════════════════════════════════════════

  private ensureRoom(roomId: string): RoomState {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = { messages: [], members: new Set() }
      this.rooms.set(roomId, room)
    }
    return room
  }

  joinRoom(agentId: string, roomId: string): void {
    const room = this.ensureRoom(roomId)
    if (room.members.has(agentId)) return

    room.members.add(agentId)
    const a = this.agents.get(agentId)
    if (a) {
      this.send(a.ws, {
        type: "room:joined",
        roomId,
        members: [...room.members],
        recentMessages: room.messages.slice(-5),
      })
    }
    this.sendToRoomMembers(room, { type: "room:member_joined", roomId, agentId })
    console.log(`[AgentHub] ${agentId} → ${roomId}`)
  }

  leaveRoom(agentId: string, roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.members.delete(agentId)
    this.sendToRoomMembers(room, { type: "room:member_left", roomId, agentId })
    // 清理空房间（保留预设）
    if (roomId !== "#lobby" && roomId !== "#review" && room.members.size === 0) {
      this.rooms.delete(roomId)
    }
  }

  sendToRoom(roomId: string, from: string, text: string): void {
    const room = this.ensureRoom(roomId)
    const msg: RoomMessage = { roomId, from, text, ts: new Date().toISOString() }
    room.messages.push(msg)
    if (room.messages.length > MAX_ROOM_MESSAGES) room.messages.shift()
    this.db?.saveMessage(roomId, from, text, msg.ts)

    // 广播给房间成员
    const raw = JSON.stringify({ type: "room:message", ...msg })
    for (const agentId of room.members) {
      const a = this.agents.get(agentId)
      if (a && a.ws.readyState === WebSocket.OPEN) a.ws.send(raw)
    }
  }

  getRoomHistory(roomId: string, limit = 50): RoomMessage[] {
    const room = this.rooms.get(roomId)
    if (!room) return []
    return room.messages.slice(-limit)
  }

  getRooms(): Array<{ roomId: string; members: string[]; messageCount: number }> {
    return [...this.rooms.entries()].map(([id, r]) => ({
      roomId: id,
      members: [...r.members],
      messageCount: r.messages.length,
    }))
  }

  // ── Room message handlers ────────────────────────────────────────────

  private handleRoomJoin(agentId: string | null, msg: HubMessage): void {
    if (!agentId) return
    this.joinRoom(agentId, String(msg.roomId || ""))
  }

  private handleRoomLeave(agentId: string | null, msg: HubMessage): void {
    if (!agentId) return
    this.leaveRoom(agentId, String(msg.roomId || ""))
  }

  private handleRoomMessage(agentId: string | null, msg: HubMessage): void {
    if (!agentId) return
    const roomId = String(msg.roomId || "")
    const text   = String(msg.text || "")
    if (!roomId || !text) return
    this.sendToRoom(roomId, agentId, text)
  }

  private handleRoomHistory(ws: WebSocket, msg: HubMessage): void {
    const roomId = String(msg.roomId || "")
    const limit  = Number(msg.limit) || 50
    this.send(ws, { type: "room:history", roomId, messages: this.getRoomHistory(roomId, limit) })
  }

  private sendToRoomMembers(room: RoomState, msg: object): void {
    const raw = JSON.stringify(msg)
    for (const agentId of room.members) {
      const a = this.agents.get(agentId)
      if (a && a.ws.readyState === WebSocket.OPEN) a.ws.send(raw)
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
    // 优先 DB 自定义标题
    const t = this.tasks.get(taskId)
    const custom = (t as any)?.title
    if (custom && custom !== taskId) return custom
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

    const rooms = this.getRooms()

    return { agents, tasks, rooms, agentCount: agents.length, taskCount: tasks.length }
  }

  // ── 关闭 ──
  close(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    this.wss?.close()
    this.agents.clear()
    this.tasks.clear()
    this.rooms.clear()
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
  rooms: Array<{
    roomId: string
    members: string[]
    messageCount: number
  }>
  agentCount: number
  taskCount: number
}

// 单例
export const agentHub = new AgentHub()
export type { HubStatus }

// 便利函数
export function startAgentHub(port: number, host = "0.0.0.0", version = "0.0.0"): void {
  agentHub.start(port, host, version)
}
