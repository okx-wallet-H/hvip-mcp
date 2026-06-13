/**
 * OKX WebSocket adapter — in-process streaming.
 *
 * OKX WS docs: https://www.okx.com/docs-v5/en/#websocket-api
 * Public:  wss://ws.okx.com:8443/ws/v5/public
 * Private: wss://ws.okx.com:8443/ws/v5/private
 */
import crypto from "node:crypto"
import type WebSocket from "ws"
import type { Auth } from "./okx.js"

const WS_PUBLIC  = "wss://ws.okx.com:8443/ws/v5/public"
const WS_PRIVATE = "wss://ws.okx.com:8443/ws/v5/private"

export interface WsSubscription {
  id: string
  channel: string
  instId: string
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
  private ws: InstanceType<typeof WebSocket> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private channelArgs = new Map<string, Set<string>>() // channel -> instIds

  async subscribe(opts: {
    channel: string
    instId: string
    type?: "public" | "private"
    auth?: Auth
  }): Promise<string> {
    const wsModule = await import("ws")
    const id = `sub_${++subCounter}`
    this.subscriptions.set(id, { id, channel: opts.channel, instId: opts.instId })

    const arg: Record<string, unknown> = { channel: opts.channel, instId: opts.instId }

    if (!this.ws || this.ws.readyState !== wsModule.WebSocket.OPEN) {
      const url = opts.type === "private" ? WS_PRIVATE : WS_PUBLIC
      await this.connect(wsModule, url, opts.auth)
    }

    if (this.ws?.readyState === wsModule.WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "subscribe", args: [arg] }))
    }

    const ck = opts.channel
    if (!this.channelArgs.has(ck)) this.channelArgs.set(ck, new Set())
    this.channelArgs.get(ck)!.add(opts.instId)

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
      this.subscriptions.delete(subId)
      this.events = this.events.filter(e => e.subId !== subId)
      return 1
    }
    const count = this.subscriptions.size
    this.subscriptions.clear()
    this.events = []
    if (this.ws) { try { this.ws.close() } catch {}; this.ws = null }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    return count
  }

  private connect(
    wsModule: typeof import("ws"),
    url: string,
    auth?: Auth,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new wsModule.WebSocket(url)
      const timeout = setTimeout(() => { ws.close(); reject(new Error("WS 连接超时(10s)")) }, 10000)

      ws.on("open", () => {
        clearTimeout(timeout)

        if (auth && url.includes("private")) {
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

        // Resubscribe
        for (const [channel, instIds] of this.channelArgs) {
          for (const instId of instIds) {
            ws.send(JSON.stringify({ op: "subscribe", args: [{ channel, instId }] }))
          }
        }

        this.pingTimer = setInterval(() => {
          if (ws.readyState === wsModule.WebSocket.OPEN) ws.send("ping")
        }, 25000)

        this.ws = ws as unknown as InstanceType<typeof WebSocket>
        resolve()
      })

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = raw.toString()
          if (msg === "pong") return
          const parsed = JSON.parse(msg)

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
                if (this.events.length > 10000) this.events = this.events.slice(-5000)
                break
              }
            }
          }
        } catch { /* ignore parse errors */ }
      })

      ws.on("error", (err: Error) => { clearTimeout(timeout); reject(err) })
      ws.on("close", () => {
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
        this.ws = null
      })
    })
  }
}
