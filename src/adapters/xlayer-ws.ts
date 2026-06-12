import WebSocket from "ws"

// ── 配置 ──────────────────────────────────────────────────────────────────
const WS_URL = process.env.XLAYER_WS_URL || "wss://xlayerws.okx.com"
const MAX_EVENTS = 500

// ── 类型 ──────────────────────────────────────────────────────────────────
interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ActiveSubscription {
  type: "newHeads" | "logs"
  events: unknown[]
}

// ── 连接管理器 ────────────────────────────────────────────────────────────
class XLayerWSManager {
  private ws: WebSocket | null = null
  private pending = new Map<number, PendingCall>()
  private subscriptions = new Map<string, ActiveSubscription>()
  private idCounter = 0
  private connectPromise: Promise<void> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  // ── 连接 ──
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL)

      ws.on("open", () => {
        this.ws = ws
        this.connectPromise = null
        // 心跳保活
        this.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping()
        }, 30_000)
        resolve()
      })

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          // 订阅推送
          if (msg.method === "eth_subscription" && msg.params) {
            const subId = msg.params.subscription
            const sub = this.subscriptions.get(subId)
            if (sub) {
              sub.events.push(msg.params.result)
              if (sub.events.length > MAX_EVENTS) sub.events.shift()
            }
            return
          }
          // RPC 响应
          if (msg.id != null) {
            const pending = this.pending.get(msg.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(msg.id)
              if (msg.error) {
                pending.reject(new Error(`RPC ${msg.error.code}: ${msg.error.message}`))
              } else {
                pending.resolve(msg.result)
              }
            }
          }
        } catch {
          // 忽略解析失败的消息
        }
      })

      ws.on("close", () => {
        this.ws = null
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
        // 清理所有等待中的调用
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer)
          p.reject(new Error("WebSocket 连接已断开"))
          this.pending.delete(id)
        }
      })

      ws.on("error", (err) => {
        this.connectPromise = null
        reject(err)
      })
    })

    return this.connectPromise
  }

  // ── JSON-RPC 调用 ──
  async callRPCMethod(method: string, params: unknown[] = []): Promise<unknown> {
    await this.connect()
    const ws = this.ws!
    const id = ++this.idCounter

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC 调用超时: ${method}`))
      }, 30_000)

      this.pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    })
  }

  // ── 订阅 ──
  async subscribe(type: "newHeads" | "logs", params?: { address?: string; topics?: string[] }): Promise<string> {
    await this.connect()
    const ws = this.ws!

    const subscribeParams: unknown[] = [type]
    if (type === "logs" && params) {
      const filter: Record<string, unknown> = {}
      if (params.address) filter.address = params.address
      if (params.topics) filter.topics = params.topics
      subscribeParams.push(filter)
    }

    const subId = await this.callRPCMethod("eth_subscribe", subscribeParams) as string

    this.subscriptions.set(subId, { type, events: [] })
    return subId
  }

  // ── 取消订阅 ──
  async unsubscribe(subId: string): Promise<boolean> {
    const result = await this.callRPCMethod("eth_unsubscribe", [subId])
    this.subscriptions.delete(subId)
    return result === true
  }

  // ── 获取缓存事件 ──
  getEvents(subId: string): { type: string; events: unknown[] } | null {
    const sub = this.subscriptions.get(subId)
    if (!sub) return null
    const events = [...sub.events]
    sub.events = [] // 取后清空
    return { type: sub.type, events }
  }

  // ── 列出活跃订阅 ──
  listSubscriptions(): Array<{ id: string; type: string; eventCount: number }> {
    return [...this.subscriptions.entries()].map(([id, sub]) => ({
      id,
      type: sub.type,
      eventCount: sub.events.length,
    }))
  }

  // ── 关闭 ──
  close(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    this.ws?.close()
    this.ws = null
    this.subscriptions.clear()
    this.pending.clear()
    this.connectPromise = null
  }
}

// 单例导出
export const xlayerWS = new XLayerWSManager()
