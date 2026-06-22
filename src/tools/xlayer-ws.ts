import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { xlayerWS } from "../adapters/xlayer-ws.js"
import { toResult, toError , registerTool} from "./shared.js"

export function registerXLayerWSTools(server: McpServer): void {

  // ── xlayer_subscribe ──────────────────────────────────────────────────
  registerTool(
    server,
    "ws_xlayer_subscribe",
    "READ",
    "[D:WebSocket] X Layer链上",
    {
      type:    z.enum(["newHeads","logs"]).describe("订阅类型。newHeads=新区块头, logs=合约日志"),
      address: z.string().optional().describe("合约地址，logs类型可用（多个地址用逗号分隔）"),
      topics:  z.string().optional().describe("日志主题，logs类型可用（多个主题用逗号分隔）"),
    },
    async ({ type, address, topics }) => {
      try {
        const params: { address?: string; topics?: string[] } = {}
        if (address) {
          const addrs = address.split(",").map(s => s.trim()).filter(Boolean)
          params.address = addrs.length === 1 ? addrs[0] : addrs
        }
        if (topics) {
          params.topics = topics.split(",").map(s => s.trim()).filter(Boolean)
        }
        const subId = await xlayerWS.subscribe(type, params)
        return toResult({
          subscriptionId: subId,
          type,
          filter: Object.keys(params).length > 0 ? params : undefined,
          tip: "事件已开始缓存。调用 xlayer_get_events 拉取（每次拉取后自动清空）。不再需要时调用 xlayer_unsubscribe 取消。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── xlayer_get_events ──────────────────────────────────────────────────
  registerTool(
    server,
    "ws_xlayer_events",
    "READ",
    "[D:WebSocket] X Layer链上",
    {
      subscriptionId: z.string().describe("订阅ID，由 xlayer_subscribe 返回"),
    },
    async ({ subscriptionId }) => {
      try {
        const data = xlayerWS.getEvents(subscriptionId)
        if (!data) {
          return toResult({
            subscriptionId,
            events: [],
            count: 0,
            tip: "订阅不存在或已过期。请重新调用 xlayer_subscribe 创建订阅。",
          })
        }
        const events = data.events
        return toResult({
          subscriptionId,
          type: data.type,
          events,
          count: events.length,
          tip: events.length === 0
            ? "暂无新事件。可稍后再次拉取（新事件到达后会缓存）。"
            : `已拉取 ${events.length} 条事件，缓存已清空。可继续调用本工具获取新事件。`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── xlayer_unsubscribe ──────────────────────────────────────────────────
  registerTool(
    server,
    "ws_xlayer_unsubscribe",
    "READ",
    "[D:WebSocket] X Layer链上",
    {
      subscriptionId: z.string().describe("要取消的订阅ID"),
    },
    async ({ subscriptionId }) => {
      try {
        const ok = await xlayerWS.unsubscribe(subscriptionId)
        return toResult({ subscriptionId, unsubscribed: ok })
      } catch (e) { return toError(e) }
    }
  )

  // ── xlayer_call ──────────────────────────────────────────────────────
  registerTool(
    server,
    "ws_xlayer_call",
    "WRITE",
    "[D:WebSocket] X Layer链上",
    {
      method: z.string().describe("JSON-RPC 方法名。常用: eth_blockNumber, eth_getBlockByNumber, eth_getBalance, eth_getTransactionReceipt, eth_call, eth_getLogs"),
      params: z.string().optional().describe("JSON-RPC 参数数组，JSON 字符串。如 '[\\\"0xabc123\\\", false]'。留空表示传空数组"),
    },
    async ({ method, params }) => {
      try {
        let parsedParams: unknown[] = []
        if (params) {
          try {
            parsedParams = JSON.parse(params)
            if (!Array.isArray(parsedParams)) parsedParams = [parsedParams]
          } catch {
            return toError(new Error(`params 格式错误：无法解析为 JSON。请传入 JSON 数组字符串，如 '[\\"latest\\", false]'`))
          }
        }
        const result = await xlayerWS.callRPCMethod(method, parsedParams)
        return toResult({ method, params: parsedParams, result })
      } catch (e) { return toError(e) }
    }
  )

  // ── xlayer_list_subscriptions ──────────────────────────────────────────
  registerTool(
    server,
    "ws_xlayer_subscriptions",
    "READ",
    "[D:WebSocket] X Layer链上",
    {},
    async () => {
      try {
        const subs = xlayerWS.listSubscriptions()
        return toResult({ subscriptions: subs, count: subs.length })
      } catch (e) { return toError(e) }
    }
  )
}
