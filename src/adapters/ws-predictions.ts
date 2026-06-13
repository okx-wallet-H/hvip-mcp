/**
 * OKX Predictions WebSocket adapter.
 *
 * Endpoint: wss://ws.okx.com:8443/ws/v5/business
 * Public channels: prediction-market-prices, pm-books, pm-trades, pm-tickers, pm-event-status, pm-candle*
 * Private channels: pm-order, pm-position, pm-user-trade, pm-balance, pm-pnl
 */
import crypto from "node:crypto"
import type { Auth } from "./okx.js"

const WS_BUSINESS = "wss://ws.okx.com:8443/ws/v5/business"

export interface PmSubscription {
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
let wsInstance: any = null
let wsConnected = false
let wsLoginDone = false
let pendingSubs: PmSubscription[] = []
const subscriptions = new Map<string, PmSubscription>()
const buffer: BufferedEvent[] = []
const onStatus: ((msg: string) => void)[] = []

function notify(msg: string) { for (const cb of onStatus) try { cb(msg) } catch {} }

function loginArgs(auth?: Auth) {
  if (!auth) return null
  const ts = new Date().toISOString().replace(/(\.\d{3})\d*Z/, "$1Z")
  const msg = ts + "GET" + "/users/self/verify"
  const sign = crypto.createHmac("sha256", auth.secret).update(msg).digest("base64")
  return [{
    apiKey: auth.apiKey,
    passphrase: auth.passphrase,
    timestamp: ts,
    sign,
  }]
}

function buildSubArgs(subs: PmSubscription[]): unknown[] {
  return subs.map(s => ({ channel: s.channel, instId: s.instId }))
}

export class PredictionsWsManager {
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectCount = 0

  constructor(private auth?: Auth) {}

  async connect(): Promise<{ id: string; channel: string; instId: string }[]> {
    if (wsInstance && wsConnected) return await this.resubscribe()
    return new Promise((resolve, reject) => {
      try {
        const WebSocket = require("ws")
        wsInstance = new WebSocket(WS_BUSINESS)
      } catch (e) {
        return reject(new Error("ws 包未安装。运行: npm install ws"))
      }

      wsInstance.on("open", () => {
        wsConnected = true
        this.reconnectCount = 0
        notify("connected")
        // Auto login if auth provided
        if (this.auth) {
          const args = loginArgs(this.auth)
          if (args) {
            wsInstance.send(JSON.stringify({ op: "login", args }))
          }
        }
        // Resolve immediately, subs will be sent after login or right away
        resolve([])
      })

      wsInstance.on("message", (raw: string) => {
        try {
          const msg = JSON.parse(raw)
          // Login response
          if (msg.event === "login" && msg.code === "0") {
            wsLoginDone = true
            notify("login_ok")
            // Send pending subscriptions
            sendPending()
          }
          if (msg.event === "login" && msg.code !== "0") {
            notify("login_fail:" + msg.msg)
          }
          // Subscribe response
          if (msg.event === "subscribe") {
            notify("subscribed:" + (msg.arg?.channel || ""))
          }
          // Unsubscribe response
          if (msg.event === "unsubscribe") {
            notify("unsubscribed:" + (msg.arg?.channel || ""))
          }
          // Error
          if (msg.event === "error") {
            notify("error:" + msg.msg)
          }
          // Data events
          if (msg.arg && msg.data && msg.action !== undefined) {
            const channel = msg.arg.channel
            const instId = msg.arg.instId || ""
            for (const [, sub] of subscriptions) {
              if (sub.channel === channel && (!instId || sub.instId === instId)) {
                buffer.push({
                  subId: sub.id,
                  channel,
                  instId,
                  ts: Date.now(),
                  data: msg,
                })
              }
            }
          }
        } catch {}
      })

      wsInstance.on("close", () => {
        wsConnected = false
        wsLoginDone = false
        notify("disconnected")
        this.scheduleReconnect()
      })

      wsInstance.on("error", (err: Error) => {
        notify("error:" + err.message)
      })
    })
  }

  private scheduleReconnect() {
    if (this.reconnectCount >= 3) {
      notify("reconnect_fail: max retries")
      return
    }
    this.reconnectCount++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectCount), 10000)
    notify("reconnecting in " + delay + "ms (try " + this.reconnectCount + "/3)")
    this.connectTimer = setTimeout(() => {
      this.connect().catch(() => {})
    }, delay)
  }

  async disconnect() {
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null }
    if (wsInstance) {
      wsInstance.close()
      wsInstance = null
    }
    wsConnected = false
    wsLoginDone = false
    subscriptions.clear()
    pendingSubs = []
    notify("disconnected")
  }

  async subscribe(channel: string, instId: string): Promise<string> {
    if (!wsConnected) await this.connect()
    const id = "pm_" + (++subCounter)
    const sub: PmSubscription = { id, channel, instId }
    subscriptions.set(id, sub)

    if (wsConnected && wsInstance) {
      if (isPrivateChannel(channel) && !wsLoginDone) {
        pendingSubs.push(sub)
      } else {
        wsInstance.send(JSON.stringify({
          op: "subscribe",
          args: [{ channel, instId }],
        }))
      }
    }
    return id
  }

  async unsubscribe(subId: string) {
    const sub = subscriptions.get(subId)
    if (!sub) return
    subscriptions.delete(subId)
    if (wsConnected && wsInstance) {
      wsInstance.send(JSON.stringify({
        op: "unsubscribe",
        args: [{ channel: sub.channel, instId: sub.instId }],
      }))
    }
  }

  async resubscribe(): Promise<{ id: string; channel: string; instId: string }[]> {
    if (!wsInstance) return []
    const subs = Array.from(subscriptions.values())
    if (subs.length === 0) return []
    // Group by private vs public
    const pub = subs.filter(s => !isPrivateChannel(s.channel))
    const priv = subs.filter(s => isPrivateChannel(s.channel))
    if (pub.length > 0) {
      wsInstance.send(JSON.stringify({ op: "subscribe", args: buildSubArgs(pub) }))
    }
    if (priv.length > 0 && wsLoginDone) {
      wsInstance.send(JSON.stringify({ op: "subscribe", args: buildSubArgs(priv) }))
    }
    return subs
  }

  status() {
    return {
      connected: wsConnected,
      loginDone: wsLoginDone,
      subscriptions: subscriptions.size,
      bufferSize: buffer.length,
      reconnectAttempts: this.reconnectCount,
    }
  }

  events(limit: number): BufferedEvent[] {
    return buffer.splice(0, limit)
  }

  onStatus(cb: (msg: string) => void) { onStatus.push(cb) }
}

function isPrivateChannel(ch: string): boolean {
  return ["pm-order","pm-position","pm-user-trade","pm-balance","pm-pnl"].includes(ch)
}

export const PUBLIC_PM_CHANNELS = [
  "prediction-market-prices", "pm-books", "pm-trades", "pm-tickers", "pm-event-status",
] as const

export const CANDLE_PM_CHANNELS = [
  "pm-candle1m", "pm-candle5m", "pm-candle15m", "pm-candle1H", "pm-candle4H", "pm-candle1D",
] as const

export const PRIVATE_PM_CHANNELS = [
  "pm-order", "pm-position", "pm-user-trade", "pm-balance", "pm-pnl",
] as const

export const ALL_PM_CHANNELS = [...PUBLIC_PM_CHANNELS, ...CANDLE_PM_CHANNELS, ...PRIVATE_PM_CHANNELS] as const
