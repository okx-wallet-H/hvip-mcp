/**
 * OKX WebSocket adapter — lightweight, in-process streaming.
 *
 * Connects to OKX public/private WebSocket channels and buffers events
 * in memory for the MCP Agent to consume via okx_ws_events.
 *
 * References:
 *   OKX WS docs: https://www.okx.com/docs-v5/en/#websocket-api
 *   Public channel:  wss://ws.okx.com:8443/ws/v5/public
 *   Private channel: wss://ws.okx.com:8443/ws/v5/private
 */
import type WebSocket from "ws"
import type { Auth } from "./okx.js"

const WS_PUBLIC  = "wss://ws.okx.com:8443/ws/v5/public"
const WS_PRIVATE = "wss://ws.okx.com:8443/ws/v5/private"

export interface WsSubscription {
  id: string
  channel: string
  instId: string
  args: Record<string, unknown>
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
  private subscriptions: Map<string, WsSubscription> = new Map()
  private events: BufferedEvent[] = []
  private ws: InstanceType<typeof WebSocket> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private channelArgs: Map<string, Set<string>> = new Map() // channel -> set of instIds

  async subscribe(opts: {
    channel: string
    instId: string
    type?: "public" | "private"
    auth?: Auth
  }): Promise<string> {
    const wsModule = await import("ws")

    const id = `sub_${++subCounter}`
    const sub: WsSubscription = { id, channel: opts.channel, instId: opts.instId, args: {} }
    this.subscriptions.set(id, sub)

    const arg = this.buildArg(opts.channel, opts.instId)

    // Connect if not connected
    if (!this.ws || this.ws.readyState !== wsModule.WebSocket.OPEN) {
      const url = opts.type === "private" ? WS_PRIVATE : WS_PUBLIC
      await this.connect(wsModule, url, opts.auth)
    }

    // Subscribe to channel
    if (this.ws && this.ws.readyState === wsModule.WebSocket.OPEN) {
      const subMsg = JSON.stringify({ op: "subscribe", args: [arg] })
      this.ws.send(subMsg)
    }

    // Track channel-instId mapping for reconnect
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

  countAllBuffered(): number {
    return this.events.length
  }

  getStatus(): ActiveSub[] {
    return Array.from(this.subscriptions.values()).map(s => ({
      id: s.id,
      active: true,
      channel: s.channel,
      instId: s.instId,
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

    if (this.ws) {
      try { this.ws.close() } catch {}
      this.ws = null
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    return count
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private buildArg(channel: string, instId: string): Record<string, unknown> {
    const arg: Record<string, unknown> = { channel, instId }
    // books channel needs depth parameter
    if (channel === "books5" || channel === "books") {
      // default OKX handles it, but explicit is safer
    }
    return arg
  }

  private connect(
    wsModule: typeof import("ws"),
    url: string,
    auth?: Auth,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new wsModule.WebSocket(url)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("WebSocket connect timeout (10s)"))
      }, 10000)

      ws.on("open", () => {
        clearTimeout(timeout)

        // Login if private
        if (auth && url.includes("private")) {
          const ts = Math.floor(Date.now() / 1000).toString()
          const crypto = require("node:crypto")
          const sign = crypto
            .createHmac("sha256", auth.secret)
            .update(ts + "GET" + "/users/self/verify")
            .digest("base64")
          ws.send(JSON.stringify({
            op: "login",
            args: [{
              apiKey: auth.apiKey,
              passphrase: auth.passphrase,
              timestamp: ts,
              sign,
            }]
          }))
        }

        // Resubscribe all with new URL-specific filtering
        const publicOrPrivate = url.includes("private") ? "private" : "public"
        for (const [channel, instIds] of this.channelArgs) {
          for (const instId of instIds) {
            ws.send(JSON.stringify({
              op: "subscribe",
              args: [this.buildArg(channel, instId)]
            }))
          }
        }

        // Ping every 25s
        this.pingTimer = setInterval(() => {
          if (ws.readyState === wsModule.WebSocket.OPEN) {
            ws.send("ping")
          }
        }, 25000)

        this.ws = ws as unknown as InstanceType<typeof WebSocket>
        resolve()
      })

      ws.on("message", (raw: Buffer) => {
        try {
          const msg = raw.toString()
          if (msg === "pong") return

          const parsed = JSON.parse(msg)

          // Event messages have "arg" + "data"
          if (parsed.arg && parsed.data) {
            const arg = parsed.arg
            // Find matching subscription
            for (const [id, sub] of this.subscriptions) {
              if (sub.channel === arg.channel && sub.instId === arg.instId) {
                this.events.push({
                  subId: id,
                  channel: arg.channel || sub.channel,
                  instId: arg.instId || sub.instId,
                  ts: Date.now(),
                  data: parsed.data,
                })

                // Cap buffer at 10000 to prevent memory leak
                if (this.events.length > 10000) {
                  this.events = this.events.slice(-5000)
                }
                break
              }
            }
          }

          // Handle subscribe confirmations
          if (parsed.event === "subscribe") {
            // arg contains the channel subscription was confirmed for
          }

          // Handle errors
          if (parsed.event === "error") {
            console.error("[hvip-ws] OKX WS error:", parsed.msg || parsed)
          }
        } catch {
          // Ignore parse errors, keep connection alive
        }
      })

      ws.on("error", (err: Error) => {
        clearTimeout(timeout)
        console.error("[hvip-ws] WS error:", err.message)
        reject(err)
      })

      ws.on("close", () => {
        if (this.pingTimer) clearInterval(this.pingTimer)
        this.ws = null
      })
    })
  }
}
