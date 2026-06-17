/**
 * OKX WebSocket adapter — in-process streaming.
 *
 * OKX WS docs: https://www.okx.com/docs-v5/en/#websocket-api
 * Public:  wss://ws.okx.com:8443/ws/v5/public
 * Private: wss://ws.okx.com:8443/ws/v5/private
 *
 * Note: WsManager 单例，共享 event buffer。单 MCP 会话安全；
 * 多会话 HTTP 模式下 drain() 按 subId 过滤，不会串事件。
 */
import crypto from "node:crypto"
import type WebSocket from "ws"
import WebSocketImpl from "ws"
import type { Auth } from "./okx.js"

const WS_PUBLIC  = "wss://ws.okx.com:8443/ws/v5/public"
const WS_PRIVATE = "wss://ws.okx.com:8443/ws/v5/private"

export interface WsSubscription {
  id: string
  channel: string
  instId: string
  type: "public" | "private"
}

interface BufferedEvent {
  subId: string
  channel: string
  instId: string
  ts: number
  data: unknown
}

interface ActiveSub {
  id: string
  active: boolean
  channel: string
  instId: string
  buffered: number
}

let subCounter = 0

export class WsManager {
  private subscriptions = new Map<string, WsSubscription>()
  private events: BufferedEvent[] = []
  private wsPub: InstanceType<typeof WebSocket> | null = null
  private wsPriv: InstanceType<typeof WebSocket> | null = null
  private pingPub: ReturnType<typeof setInterval> | null = null
  private pingPriv: ReturnType<typeof setInterval> | null = null
  // Fix #1: 按 type 拆分 channelArgs，重连时只遍历同类型
  private channelArgsPub = new Map<string, Set<string>>()
  private channelArgsPriv = new Map<string, Set<string>>()

  private getWs(type: "public" | "private"): InstanceType<typeof WebSocket> | null {
    return type === "public" ? this.wsPub : this.wsPriv
  }
  private setWs(type: "public" | "private", ws: InstanceType<typeof WebSocket> | null): void {
    if (type === "public") this.wsPub = ws
    else this.wsPriv = ws
  }
  private getPing(type: "public" | "private"): ReturnType<typeof setInterval> | null {
    return type === "public" ? this.pingPub : this.pingPriv
  }
  private setPing(type: "public" | "private", timer: ReturnType<typeof setInterval> | null): void {
    if (type === "public") this.pingPub = timer
    else this.pingPriv = timer
  }
  private getChannelArgs(type: "public" | "private"): Map<string, Set<string>> {
    return type === "public" ? this.channelArgsPub : this.channelArgsPriv
  }

  async subscribe(opts: {
    channel: string
    instId: string
    type?: "public" | "private"
    auth?: Auth
  }): Promise<string> {
    const id = `sub_${++subCounter}`
    const type = opts.type || "public"
    this.subscriptions.set(id, { id, channel: opts.channel, instId: opts.instId, type })

    const arg: Record<string, unknown> = { channel: opts.channel, instId: opts.instId }

    const currentWs = this.getWs(type)
    if (!currentWs || currentWs.readyState !== WebSocketImpl.OPEN) {
      const url = type === "private" ? WS_PRIVATE : WS_PUBLIC
      await this.connect(url, opts.auth, type)
    }

    const targetWs = this.getWs(type)
    if (targetWs?.readyState === WebSocketImpl.OPEN) {
      targetWs.send(JSON.stringify({ op: "subscribe", args: [arg] }))
    }

    const chanArgs = this.getChannelArgs(type)
    if (!chanArgs.has(opts.channel)) chanArgs.set(opts.channel, new Set())
    chanArgs.get(opts.channel)!.add(opts.instId)

    return id
  }

  drain(subId?: string, limit = 20): BufferedEvent[] {
    let batch: BufferedEvent[]
    if (subId) {
      batch = this.events.filter(e => e.subId === subId)
      this.events = this.events.filter(e => e.subId !== subId)
    } else {
      batch = this.events.splice(0, limit)
    }
    return batch.slice(0, limit)
  }

  countBuffered(subId?: string): number {
    if (subId) return this.events.filter(e => e.subId === subId).length
    return this.events.length
  }

  countAllBuffered(): number { return this.events.length }

  getStatus(): ActiveSub[] {
    return [...this.subscriptions.values()].map(s => ({
      id: s.id, active: true, channel: s.channel, instId: s.instId,
      buffered: this.countBuffered(s.id),
    }))
  }

  close(subId?: string): number {
    if (subId) {
      const sub = this.subscriptions.get(subId)
      if (sub) {
        // Fix #2: 清理 channelArgs
        const chanArgs = this.getChannelArgs(sub.type)
        const instIds = chanArgs.get(sub.channel)
        if (instIds) {
          instIds.delete(sub.instId)
          if (instIds.size === 0) chanArgs.delete(sub.channel)
        }
        // 向服务端发送 unsubscribe（好习惯）
        const ws = this.getWs(sub.type)
        if (ws?.readyState === WebSocketImpl.OPEN) {
          try { ws.send(JSON.stringify({ op: "unsubscribe", args: [{ channel: sub.channel, instId: sub.instId }] })) } catch {}
        }
      }
      this.subscriptions.delete(subId)
      this.events = this.events.filter(e => e.subId !== subId)
      return 1
    }
    const count = this.subscriptions.size
    this.subscriptions.clear()
    this.channelArgsPub.clear()
    this.channelArgsPriv.clear()
    this.events = []
    for (const ws of [this.wsPub, this.wsPriv]) {
      if (ws) { try { ws.close() } catch {} }
    }
    this.wsPub = null; this.wsPriv = null
    for (const t of [this.pingPub, this.pingPriv]) {
      if (t) { clearInterval(t) }
    }
    this.pingPub = null; this.pingPriv = null
    return count
  }

  private connect(
    url: string,
    auth: Auth | undefined,
    type: "public" | "private",
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocketImpl(url)
      const timeout = setTimeout(() => { ws.close(); reject(new Error("WS 连接超时(10s)")) }, 10000)

      ws.on("open", () => {
        clearTimeout(timeout)

        if (auth && type === "private") {
          const ts = Math.floor(Date.now() / 1000).toString()
          const sign = crypto
            .createHmac("sha256", auth.secret)
            .update(ts + "GET" + "/users/self/verify")
            .digest("base64")
          ws.send(JSON.stringify({
            op: "login",
            args: [{ apiKey: auth.apiKey, passphrase: auth.passphrase, timestamp: ts, sign }],
          }))
        }

        // Fix #1: 只重连同类型的频道
        const chanArgs = this.getChannelArgs(type)
        for (const [channel, instIds] of chanArgs) {
          for (const instId of instIds) {
            ws.send(JSON.stringify({ op: "subscribe", args: [{ channel, instId }] }))
          }
        }

        const timer = setInterval(() => {
          if (ws.readyState === WebSocketImpl.OPEN) ws.send("ping")
        }, 25000)
        this.setPing(type, timer)

        this.setWs(type, ws as unknown as InstanceType<typeof WebSocket>)
        resolve()
      })

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = raw.toString()
          if (msg === "pong") return
          const parsed = JSON.parse(msg)

          // OKX WS 错误事件 — 包装为可读消息
          if (parsed.event === "error" && parsed.code) {
            this.events.push({
              subId: "__error__",
              channel: parsed.arg?.channel || "unknown",
              instId: parsed.arg?.instId || "",
              ts: Date.now(),
              data: {
                error: true,
                code: parsed.code,
                message: parsed.msg || "WebSocket 错误",
                hint: parsed.code === "60001" ? "频道名不支持或参数错误，请检查 channel 值" :
                       parsed.code === "60003" ? "登录已过期，请重连" :
                       parsed.code === "60009" ? "私有频道需要先 login（API Key 签名）" :
                       `OKX WS 错误 ${parsed.code}`,
              },
            })
            if (this.events.length > 10000) { if (this.events.length === 10001) process.stderr.write(`[WS] ⚠️ 事件缓冲已满(>10000)，开始截断旧事件\n`); this.events = this.events.slice(-5000) }
            return
          }

          if (parsed.arg && parsed.data) {
            for (const [id, sub] of this.subscriptions) {
              if (sub.channel === parsed.arg.channel && sub.instId === parsed.arg.instId) {
                this.events.push({
                  subId: id,
                  channel: parsed.arg.channel || sub.channel,
                  instId: parsed.arg.instId || sub.instId,
                  ts: Date.now(),
                  data: parsed.data,
                })
                if (this.events.length > 10000) { if (this.events.length === 10001) process.stderr.write(`[WS] ⚠️ 事件缓冲已满(>10000)，开始截断旧事件\n`); this.events = this.events.slice(-5000) }
                break
              }
            }
          }
        } catch { process.stderr.write(`[WS] ⚠️ 畸形 WS 消息: ${raw.toString().slice(0, 80)}\n`) }
      })

      ws.on("error", (err: Error) => { clearTimeout(timeout); reject(err) })
      ws.on("close", () => {
        const t = this.getPing(type)
        if (t) { clearInterval(t); this.setPing(type, null) }
        this.setWs(type, null)
      })
    })
  }
}
