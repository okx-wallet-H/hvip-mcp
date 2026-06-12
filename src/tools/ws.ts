/**
 * OKX WebSocket streaming tools for Agent.
 *
 * In-memory event buffer shared across tool calls within the same MCP session.
 * Agent calls okx_ws_subscribe once → events flow into buffer →
 * Agent calls okx_ws_events to drain the pipe → act on events.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { getAuth } from "./shared.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"
import { WsManager } from "../adapters/ws.js"

/** Global WS manager – lives as long as the MCP server process */
let wsManager: WsManager | null = null

function getOrCreateWs(): WsManager {
  if (!wsManager) wsManager = new WsManager()
  return wsManager
}

// ── Public channels without auth ──────────────────────────────────────────
const PUBLIC_CHANNELS = [
  "tickers",        // 全量行情推送
  "trades",         // 实时成交
  "candle1m",       // 1分钟K线
  "candle5m",       // 5分钟K线
  "candle15m",      // 15分钟K线
  "candle1H",       // 1小时K线
  "candle4H",       // 4小时K线
  "candle1D",       // 日K线
  "books5",         // 5档深度
  "books",          // 400档全深度
  "mark-price",     // 标记价格
  "funding-rate",   // 资金费率
  "open-interest",  // 持仓量
  "price-limit",    // 限价范围
  "index-tickers",  // 指数行情
] as const

const PUBLIC_CHANNELS_STR = PUBLIC_CHANNELS.join("、")

export function registerWsTools(server: McpServer): void {

  // ═══════════════════════════════════════════════════════════════════════
  // okx_ws_subscribe — 开启 WebSocket 事件流
  // ═══════════════════════════════════════════════════════════════════════
  server.tool(
    "okx_ws_subscribe",
    `## 功能：订阅OKX WebSocket实时数据，事件自动缓冲在内存中，Agent可通过 okx_ws_events 拉取
## 场景：Agent 需要实时监控行情变化而非轮询时调用（例如"盯着BTC价格，突破64000告诉我"）
## 关键词：WebSocket, ws, 实时推送, 实时行情, 订阅, subscribe, 流式, streaming
## 参数：
##   - instId: 产品ID，如 BTC-USDT、ETH-USDT-SWAP。必填
##   - channel: 频道名。支持: ${PUBLIC_CHANNELS_STR}
##   - instType: SPOT/SWAP/FUTURES/OPTION。用于 tickers 和 trades 频道时必填
## 鉴权：PUBLIC — 公开频道，不需要 API Key
## 风险：READ — 只读订阅，Agent 可自动调用
## 返回：立即返回订阅状态，事件通过 okx_ws_events 获取
## 关联：okx_ws_subscribe 订阅 → okx_ws_events 拉取事件 → 决策 → okx_ws_close 关闭`,
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP"),
      channel: z.string().describe(`频道名。支持: ${PUBLIC_CHANNELS_STR}`),
      instType: z.enum(["SPOT","SWAP","FUTURES","OPTION"]).optional().describe("tickers/trades 频道需要"),
    },
    async ({ instId, channel }) => {
      try {
        // Validate channel
        if (!PUBLIC_CHANNELS.includes(channel as any)) {
          return toError(new Error(
            `频道 "${channel}" 不支持。公共频道支持: ${PUBLIC_CHANNELS_STR}`
          ))
        }

        const ws = getOrCreateWs()
        const subId = await ws.subscribe({
          channel: channel as string,
          instId: instId.toUpperCase(),
          type: "public",
        })

        return toResult({
          subscribed: true,
          subscriptionId: subId,
          channel,
          instId: instId.toUpperCase(),
          buffered: ws.countBuffered(subId),
          hint: `已订阅 ${instId.toUpperCase()} 的 ${channel} 频道。事件实时缓冲中，调用 okx_ws_events 拉取。`,
          tip: "高频事件（tickers每100ms、trades实时）累积很快。建议 okx_ws_events 加 filter 过滤，或只取最近N条。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ═══════════════════════════════════════════════════════════════════════
  // okx_ws_events — 拉取缓冲的事件
  // ═══════════════════════════════════════════════════════════════════════
  server.tool(
    "okx_ws_events",
    `## 功能：拉取 okx_ws_subscribe 缓冲的实时事件，每次调用清空缓冲区返回新事件
## 场景：Agent 巡回检查"有什么新行情"时调用、代替轮询 REST API
## 关键词：拉取, poll, 事件, events, 缓冲区, 最新消息
## 参数：
##   - subscriptionId: 订阅ID（从 okx_ws_subscribe 返回）。不传则返回所有订阅的事件
##   - limit: 最大返回条数，默认 20，防止上下文爆炸
##   - filter: 过滤关键词。如"64000"只返回价格相关的、"vol"只返回成交量异动
## 鉴权：PUBLIC — 读内存缓冲区，不需要 API Key
## 风险：READ — 只读，Agent 可自动调用
## 返回量：受 limit 控制，默认 ~2KB
## 关联：okx_ws_subscribe 订阅 → 本工具拉取 → 决策 → okx_ws_close 关闭`,
    {
      subscriptionId: z.string().optional().describe("订阅ID（从 okx_ws_subscribe 返回）"),
      limit: z.number().min(1).max(50).default(20).describe("最大返回条数，默认20"),
      filter: z.string().optional().describe("过滤关键词"),
    },
    async ({ subscriptionId, limit, filter }) => {
      try {
        const ws = getOrCreateWs()
        let events = ws.drain(subscriptionId, limit)

        if (filter) {
          const kw = filter.toLowerCase()
          events = events.filter(e =>
            JSON.stringify(e).toLowerCase().includes(kw)
          )
        }

        events = events.slice(0, limit)

        const remaining = ws.countAllBuffered()
        const subs = ws.getStatus()

        return toResult({
          events,
          count: events.length,
          remaining: remaining - events.length,
          hint: remaining > 0
            ? `还有 ${remaining - events.length} 条未读取，再调一次 okx_ws_events 拉取`
            : "缓冲区为空，等待新事件到来",
          active: subs.filter(s => s.active),
          tip: "高频事件累积快，建议设置 limit 控制返回量。用 filter 过滤特定关键词减少噪音。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ═══════════════════════════════════════════════════════════════════════
  // okx_ws_status — 查看当前订阅状态
  // ═══════════════════════════════════════════════════════════════════════
  server.tool(
    "okx_ws_status",
    "## 功能：查看当前所有 WebSocket 订阅状态，含缓冲区事件数量\n## 场景：Agent 查看当前订阅列表和缓冲区事件数量\n## 关键词：状态, status, 订阅列表, 缓冲区, 连接\n## 参数：无\n## 鉴权：PUBLIC\n## 风险：READ — 只读",
    {},
    async () => {
      try {
        const ws = getOrCreateWs()
        return toResult({
          subscriptions: ws.getStatus(),
          totalBuffered: ws.countAllBuffered(),
          hint: "调用 okx_ws_events 拉取缓存事件，调用 okx_ws_close 关闭连接",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ═══════════════════════════════════════════════════════════════════════
  // okx_ws_close — 关闭 WebSocket 连接
  // ═══════════════════════════════════════════════════════════════════════
  server.tool(
    "okx_ws_close",
    "## 功能：关闭指定或所有 WebSocket 订阅\n## 场景：Agent 完成监控任务后关闭连接释放资源\n## 关键词：关闭, close, 取消订阅, 断开, 停止, unsubscribe\n## 参数：\n##   - subscriptionId: 要关闭的订阅ID（不传关闭所有）\n## 鉴权：PUBLIC\n## 风险：WRITE — 会断开连接，但无资金风险",
    {
      subscriptionId: z.string().optional().describe("订阅ID，不传关闭所有"),
    },
    async ({ subscriptionId }) => {
      try {
        const ws = getOrCreateWs()
        const count = ws.close(subscriptionId)
        return toResult({
          closed: count,
          hint: count === 0 ? "没有活跃的订阅" : "订阅已关闭，缓冲区已清空",
        })
      } catch (e) { return toError(e) }
    }
  )
}
