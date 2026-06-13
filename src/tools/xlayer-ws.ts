import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { xlayerWS } from "../adapters/xlayer-ws.js"
import { toResult, toError } from "./shared.js"

export function registerXLayerWSTools(server: McpServer): void {

  // ── xlayer_subscribe ──────────────────────────────────────────────────
  server.tool(
    "xlayer_subscribe",
    "CAT:[链上] | ## 功能：订阅 X Layer 链上事件（新区块头 / 合约日志），返回订阅ID\n## 场景：用于监听新区块产生、追踪特定合约事件、实时监控链上活动\n## 关键词：X Layer, WebSocket, 订阅, subscribe, newHeads, logs, 链上事件, 事件监听\n## 参数：\n##   - type: 订阅类型。newHeads=新区块头, logs=合约日志\n##   - address: 合约地址（logs 类型可选，支持单个地址或地址数组）\n##   - topics: 日志主题过滤（logs 类型可选）\n## 鉴权：PUBLIC — 公开接口，无需 API Key\n## 风险：READ — 只读订阅，Agent 可自动调用\n## 返回量：微小 ~200B — 返回订阅ID和状态\n## 关联：本工具订阅事件 → xlayer_get_events 拉取缓存事件 → xlayer_unsubscribe 取消订阅",
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
  server.tool(
    "xlayer_get_events",
    "CAT:[链上] | ## 功能：拉取指定订阅的缓存事件，每次拉取后自动清空\n## 场景：用于定期轮询订阅事件、获取最新的新区块或合约日志\n## 关键词：X Layer, 事件拉取, get events, 轮询, 订阅事件, 缓存事件\n## 参数：\n##   - subscriptionId: 订阅ID（由 xlayer_subscribe 返回）\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：取决于缓存事件数量，通常 1~50 条 ~5KB\n## 关联：xlayer_subscribe 获得订阅 → 本工具拉取事件 → xlayer_unsubscribe 取消",
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
  server.tool(
    "xlayer_unsubscribe",
    "CAT:[链上] | ## 功能：取消 X Layer WebSocket 订阅\n## 场景：用于停止不再需要的链上事件监听、释放连接资源\n## 关键词：X Layer, 取消订阅, unsubscribe, 停止监听\n## 参数：\n##   - subscriptionId: 要取消的订阅ID\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读操作，Agent 可自动调用\n## 返回量：微小 ~100B\n## 关联：xlayer_subscribe 创建订阅 → xlayer_get_events 拉取事件 → 本工具取消订阅",
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
  server.tool(
    "xlayer_call",
    "CAT:[链上] | ## 功能：通过 WebSocket 调用 X Layer JSON-RPC 方法，支持所有以太坊兼容 RPC\n## 场景：用于查询区块详情/交易收据/账户余额/合约状态、调用 eth_call 模拟交易、获取链上任意数据\n## 关键词：X Layer, JSON-RPC, eth_call, eth_getBlockByNumber, eth_getBalance, eth_getTransactionReceipt, 链上查询\n## 参数：\n##   - method: JSON-RPC 方法名。如 eth_blockNumber / eth_getBlockByNumber / eth_getBalance / eth_getTransactionReceipt / eth_call\n##   - params: JSON-RPC 参数数组，JSON 字符串格式。如 '[\"0x...\", \"latest\"]'\n## 鉴权：PUBLIC — 公开接口，无需 API Key\n## 风险：READ — 只读查询（除非发送交易，但本工具不提供 eth_sendRawTransaction）\n## 返回量：取决于方法，通常 1~5KB\n## 关联：本工具通用查询 → xlayer_subscribe 订阅需要持续监听的事件 → xlayer_get_events 拉取推送",
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
  server.tool(
    "xlayer_list_subscriptions",
    "CAT:[链上] | ## 功能：列出当前 WebSocket 连接的所有活跃订阅及缓存事件数\n## 场景：用于管理订阅生命周期、查看哪些事件类型正在监听\n## 关键词：X Layer, 订阅列表, list subscriptions, 订阅管理\n## 参数：无\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~200B\n## 关联：xlayer_subscribe 创建订阅 → 本工具查看订阅状态 → xlayer_unsubscribe 取消",
    {},
    async () => {
      try {
        const subs = xlayerWS.listSubscriptions()
        return toResult({ subscriptions: subs, count: subs.length })
      } catch (e) { return toError(e) }
    }
  )
}
