import type { Server as WSServer } from "ws"
import { WebSocketServer, WebSocket } from "ws"
import type { HubDB } from "./hub-persistence.js"
import { logger } from "../utils/logger.js"

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

const log = logger("AgentHub")

class AgentHub {
  private wss: WSServer | null = null
  private agents = new Map<string, AgentConn>()
  private tasks = new Map<string, TaskState>()
  private rooms = new Map<string, RoomState>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private version = "0.0.0"
  private startTime = 0
  port = 0  // public: updated after WS negotiate, read by hub for dashboard URL
  registryCount = 0  // set by hub-server after HubRegistry loads
  private db: HubDB | null = null
  private token = ""  // PSK 鉴权令牌
  private costTracker: any = null  // HubCosts 实例

  // ── 持久化绑定 ──

  setCostTracker(ct: any): void { this.costTracker = ct }

  setDB(db: HubDB): void {
    this.db = db
    // 从 DB 恢复任务
    const rows = db.loadTasks()
    let orphanCount = 0
    for (const r of rows) {
      // 检查是否为孤儿任务（assigned 但 worker 不在线）
      if (r.status === "assigned" && r.assignedTo && !this.agents.has(r.assignedTo)) {
        this.tasks.set(r.taskId, {
          status: "unassigned",
          assignedTo: undefined,
          claimedAt: undefined,
          result: r.result || undefined,
          branch: r.branch || undefined,
        })
        db.saveTask({ taskId: r.taskId, status: "unassigned" })
        orphanCount++
      } else {
        this.tasks.set(r.taskId, {
          status: r.status as TaskState["status"],
          assignedTo: r.assignedTo || undefined,
          claimedAt: r.claimedAt || undefined,
          result: r.result || undefined,
          branch: r.branch || undefined,
        })
      }
    }
    if (rows.length > 0) {
      log.info(`从 DB 恢复 ${rows.length} 个任务` + (orphanCount > 0 ? `，释放 ${orphanCount} 个孤儿任务` : ""))
    }
  }

  // ── 启动 ──
  start(port: number, host = "0.0.0.0", version = "0.0.0", token = ""): void {
    this.version = version
    this.startTime = Date.now()
    this.token = token
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
        log.warn(`WS Hub 跳过（端口 ${ports.join("/")} 不可用）`)
        return
      }
      log.info(`WS Hub v${version} ws://${host}:${this.port}`)
      this.setupHub()
    })
  }

  private setupHub(): void {
    if (!this.wss) return
    this.ensureRoom("#lobby")
    this.ensureRoom("#review")
    this.wss.on("connection", (ws, req) => {
      // ── Auth guard: PSK token 校验 ──
      if (this.token) {
        const urlParams = new URL(req.url || "/", "http://localhost").searchParams
        const provided = urlParams.get("token") || ""
        if (provided !== this.token) {
          ws.send(JSON.stringify({ type: "error", message: "未授权 — 请在 WS URL 中携带 ?token=..." }))
          ws.close()
          return
        }
      }

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
      ws.on("error", (e: Error) => { log.error(`WS 错误: ${e.message}`) })
    })
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, a] of this.agents) {
        // 跳过纯 Viewer（终端面板/仪表盘）—— 它们不实现 agent:status 心跳协议
        if (id.startsWith("term-") || id.startsWith("dashboard")) continue
        if (now - a.lastSeen > 120_000) {
          a.ws.close()
          this.agents.delete(id)
          log.warn("Agent 心跳超时: " + id)
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
      case "task:progress": this.broadcast(msg); break   // 流式文本转发
      case "task:tool":     this.broadcast(msg); break   // 工具调用转发
      case "task:done":     this.handleDone(msg); break
      case "task:assign":   this.handleAssign(msg); break  // Chronos AI 调度指令
      case "task:unassign": this.handleUnassign(msg); break // Chronos 释放卡住任务
      case "task:reject":   this.handleReject(msg); break  // Worker 忙时拒绝任务
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

    log.info(`Agent 注册: ${agentId} (${name}) skills: [${capabilities.join(", ")}]`)
    this.send(ws, {
      type: "agent:registered",
      agentId,
      currentVersion: this.version,
      message: `已注册。可用任务: ${this.getUnassignedTasks().join(", ") || "无"}`,
      pendingTasks: this.getUnassignedTasks(),
    })
    // 广播给其他 Agent（Chronos 需要实时感知 Worker 上线）
    this.broadcast({
      type: "agent:update",
      agentId,
      name,
      capabilities,
      status: "idle",
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
    log.info(`Agent 离线: ${agentId} (${info?.name || "?"})`)
    // 广播离线事件（Chronos 需要感知 Worker 下线）
    this.broadcast({ type: "agent:offline", agentId })

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
      // 检查原 worker 是否还在线
      const assignedWorker = task.assignedTo ? this.agents.get(task.assignedTo) : null
      if (assignedWorker) {
        this.sendTo(agentId, { type: "error", message: `任务 ${taskId} 已被 ${task.assignedTo} 认领` })
        return
      }
      // 原 worker 已断连 → 允许新 worker 接管
      log.info(`${agentId} 接管孤儿任务 ${taskId}（原 ${task.assignedTo} 已离线）`)
    }

    task.status = "assigned"
    task.assignedTo = agentId
    task.claimedAt = Date.now()

    const a = this.agents.get(agentId)
    if (a) a.status = "working"

    // 自动推入任务房间
    this.joinRoom(agentId, `#task-${taskId}`)

    log.info(`${agentId} 认领 ${taskId}`)
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
    const error = msg.error ? String(msg.error) : ""
    const usage = msg.usage as { inputTokens?: number; outputTokens?: number; model?: string } | undefined
    const steps = Number(msg.steps || 0)

    // 记录 LLM 成本
    if (this.costTracker && usage?.inputTokens) {
      this.costTracker.record({
        agentId,
        taskId,
        model: usage.model || "claude-sonnet-4-6",
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        purpose: "task",
      })
    }

    const task = this.tasks.get(taskId)
    if (!task) {
      this.sendTo(agentId, { type: "error", message: `任务 ${taskId} 不存在` })
      return
    }

    // 执行失败 → 释放任务让 Chronos 重试，不标记为 done
    // 注意：[Chronos] 前缀是 Chronos 放弃重试后的最终结果，不释放
    if (error || /^❌|^执行失败/i.test(result)) {
      task.status = "unassigned"
      task.assignedTo = undefined
      task.claimedAt = undefined

      const a = this.agents.get(agentId)
      if (a) a.status = "idle"

      this.db?.saveTask({ taskId, status: "unassigned" })
      log.info(`任务执行失败，释放重试: ${taskId} — ${error || result.slice(0, 80)}`)
      this.broadcast({ type: "agent:update", agentId, status: "idle" })
      this.broadcast({ type: "task:released", taskId, reason: `执行失败: ${error || result.slice(0, 60)}` })
      return
    }

    task.status = "done"
    task.result = result
    task.branch = branch

    const a = this.agents.get(agentId)
    if (a) a.status = "idle"

    log.info(`${agentId} 完成 ${taskId}: ${result}`)
    this.db?.saveTask({ taskId, status: "done", title: this.getTaskTitle(taskId), assignedTo: agentId, result, branch })

    // 广播 Worker 恢复空闲
    this.broadcast({ type: "agent:update", agentId, status: "idle" })

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

  // ── Chronos 释放卡住任务 ──
  private handleUnassign(msg: HubMessage): void {
    const taskId = String(msg.taskId || "")
    const reason = String(msg.reason || "Chronos 巡检释放")

    const task = this.tasks.get(taskId)
    if (!task) {
      log.warn(`Chronos 释放失败: 任务 ${taskId} 不存在`)
      return
    }
    if (task.status !== "assigned") {
      // 已经是非 assigned 状态，无需释放
      return
    }

    const oldAgentId = task.assignedTo
    task.status = "unassigned"
    task.assignedTo = undefined
    task.claimedAt = undefined

    // 如果原 worker 在线，将其状态恢复为空闲
    if (oldAgentId) {
      const oldWorker = this.agents.get(oldAgentId)
      if (oldWorker && oldWorker.status === "working") {
        oldWorker.status = "idle"
      }
    }

    this.db?.saveTask({ taskId, status: "unassigned" })
    log.warn(`Chronos 释放卡住任务: ${taskId} (原 ${oldAgentId || "?"}) — ${reason}`)
    this.broadcast({
      type: "task:released",
      taskId,
      reason: `Chronos 释放: ${reason}`,
    })
  }

  // ── Worker 拒绝任务（忙碌）──
  private handleReject(msg: HubMessage): void {
    const taskId = String(msg.taskId || "")
    const agentId = String(msg.agentId || "")
    const reason = String(msg.reason || "Worker busy")

    const task = this.tasks.get(taskId)
    if (!task) return

    // 只释放 assigned 状态的任务
    if (task.status !== "assigned") return

    task.status = "unassigned"
    task.assignedTo = undefined
    task.claimedAt = undefined

    // 恢复 Worker 状态
    const a = this.agents.get(agentId)
    if (a && a.status === "working") a.status = "idle"

    this.db?.saveTask({ taskId, status: "unassigned" })
    log.info(`任务被拒绝: ${taskId} by ${agentId} — ${reason}`)
    this.broadcast({ type: "task:released", taskId, reason: `Worker 拒绝: ${reason}` })
  }

  // ── 注册任务（自动派发给空闲 Agent） ──
  /** 检查是否有空闲的 WS Worker（非 dashboard、非 CLI spawn） */
  hasIdleWorker(): boolean {
    for (const [id, a] of this.agents) {
      if (a.status === "idle" && !id.startsWith("dashboard") && !id.startsWith("term-")) {
        return true
      }
    }
    return false
  }

  registerTask(taskId: string, title?: string, promptB64?: string): void {
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, { status: "unassigned" })
    }
    const task = this.tasks.get(taskId)!
    if (title) (task as any).title = title
    if (promptB64) (task as any).promptB64 = promptB64
    log.info(`任务注册: ${taskId} "${title || taskId}"`)

    // 广播新任务通知
    this.broadcast({ type: "task:announced", taskId, title: title || taskId })

    // Chronos AI 调度官在线 → 不自动派发，等 Chronos 决策
    const hasChronos = [...this.agents.values()].some(
      a => a.agentId === "chronos-dispatcher" && a.status !== "offline"
    )
    if (hasChronos) {
      log.info(`Chronos 在线，任务 ${taskId} 等待 AI 调度`)
      return  // Chronos 会从 task:announced 收到通知并决定派发给谁
    }

    // Fallback: 没有 Chronos → 自动寻址派发
    const idleAgents = [...this.agents.entries()]
      .filter(([,a]) => a.status === "idle" && !a.agentId.startsWith("dashboard") && !a.agentId.startsWith("term-"))
    if (idleAgents.length === 0) {
      log.warn(`没有空闲 Agent，任务 ${taskId} 等待手动 spawn`)
      return
    }
    const match = idleAgents.find(([,a]) => a.capabilities.includes(taskId))
      || idleAgents[0]
    if (match) {
      log.info(`自动派发 ${taskId} → ${match[1].name} (${match[0]})`)
      this.dispatchTaskTo(taskId, match[0], promptB64)
    }
  }

  // ── 派发任务 ──
  dispatchTaskTo(taskId: string, agentId: string, promptB64?: string): void {
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, { status: "unassigned" })
    }
    const task = this.tasks.get(taskId)!
    if (task.status === "assigned") return

    const msg: Record<string, unknown> = {
      type: "task:dispatch",
      taskId,
      title: this.getTaskTitle(taskId),
    }
    if (promptB64) msg.promptB64 = promptB64
    else if ((task as any).promptB64) msg.promptB64 = (task as any).promptB64

    this.sendTo(agentId, msg)
  }

  // ── Chronos 调度指令 ──
  private handleAssign(msg: HubMessage): void {
    const taskId = String(msg.taskId || "")
    const targetAgentId = String(msg.agentId || "")
    const assignedBy = String(msg.assignedBy || "chronos")

    if (!taskId || !targetAgentId) return

    const targetWorker = this.agents.get(targetAgentId)
    if (!targetWorker) {
      log.warn(`Chronos 指派失败: Worker ${targetAgentId} 不在线`)
      return
    }
    if (targetWorker.status !== "idle") {
      log.warn(`Chronos 指派失败: Worker ${targetAgentId} 忙碌中`)
      return
    }

    log.info(`Chronos 调度: ${taskId} → ${targetWorker.name}`)
    // Pass promptB64 from task metadata if available
    const task = this.tasks.get(taskId)
    const promptB64 = (task as any)?.promptB64 as string | undefined
    this.dispatchTaskTo(taskId, targetAgentId, promptB64)
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
    log.info(`${agentId} → ${roomId}`)
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

    return { agents, tasks, rooms, agentCount: agents.length, taskCount: tasks.length, version: this.version, uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0, registry: `${this.registryCount || 24} plugins` }
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
export function startAgentHub(port: number, host = "0.0.0.0", version = "0.0.0", token = ""): void {
  agentHub.start(port, host, version, token)
}
