import { AsyncLocalStorage } from "node:async_hooks"
import type { Auth } from "../adapters/okx.js"
import { createHRailsClient, type HRailsClient } from "../adapters/hrails.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

/**
 * 请求级 Auth 上下文（用于多用户 Chat 代理注入）
 *
 * hub-server 通过 X-OKX-Api-Key / X-OKX-Secret / X-OKX-Passphrase 头
 * 传入用户自己的 OKX 凭证。MCP HTTP handler 读取这些头并设置 ALS 上下文，
 * getAuth() 优先使用 ALS 中的凭证，fallback 到 process.env（原有行为）。
 */
export const authStore = new AsyncLocalStorage<Auth | null>()

export function getAuth(): Auth | null {
  // 1) 优先：请求级上下文（多用户 Chat 代理注入）
  const ctx = authStore.getStore()
  if (ctx?.apiKey && ctx?.secret && ctx?.passphrase) return ctx

  // 2) Fallback：环境变量（原有行为，向后兼容）
  const apiKey = process.env["OKX_API_KEY"]
  const secret = process.env["OKX_SECRET_KEY"]
  const passphrase = process.env["OKX_PASSPHRASE"]
  if (!apiKey || !secret || !passphrase) return null
  return {
    apiKey,
    secret,
    passphrase,
    isDemo: process.env["OKX_IS_DEMO"] === "true",
  }
}

export function getHRailsClient(): HRailsClient | null {
  const apiKey = process.env["HRAILS_API_KEY"]
  if (!apiKey) return null
  const base = process.env["HRAILS_BASE_URL"]
  return createHRailsClient(apiKey, base)
}

export const AUTH_REQUIRED = `此功能需要绑定 OKX API Key。

请在 Claude Desktop 配置文件中添加以下内容（hvip 不存储您的密钥，密钥仅保存在您本地）：

{
  "mcpServers": {
    "hvip": {
      "command": "npx",
      "args": ["hvip"],
      "env": {
        "OKX_API_KEY": "你的 API Key",
        "OKX_SECRET_KEY": "你的 Secret Key",
        "OKX_PASSPHRASE": "你的 Passphrase"
      }
    }
  }
}

API Key 在 OKX 官网「个人中心 → API」中创建，只需开通「读取」权限即可查询账户，交易功能还需开通「交易」权限。`

// ── instType 共享枚举（P1-2 修复） ──────────────────────────────────────────
// 每个常量背后是 OKX 不同端点真实支持的参数子集，不可随意合并
export const INST_TYPE_TRADE      = ["SPOT","MARGIN","SWAP","FUTURES","OPTION"] as const  // 交易/账户类
export const INST_TYPE_MARKET     = ["SPOT","SWAP","FUTURES","OPTION"] as const            // 行情类（不支持 MARGIN）
export const INST_TYPE_PUBLIC     = ["MARGIN","SWAP","FUTURES","OPTION"] as const          // 公开数据（标记价等，无 SPOT）
export const INST_TYPE_CONTRACTS  = ["SWAP","FUTURES","OPTION"] as const                   // 纯合约
export const INST_TYPE_SWAP_FUT   = ["SWAP","FUTURES"] as const                            // 永续+交割
export const INST_TYPE_MARGIN_PUB = ["MARGIN","SWAP","FUTURES","OPTION"] as const          // 含杠杆的公开数据
export const INST_TYPE_RUBIK      = ["SPOT","CONTRACTS"] as const                          // 交易大数据专用（OKX 原生 CONTRACTS）

// ── Agent 可读性增强：toResult 自动注入 _summary ────────────────────────────

function autoSummary(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    const n = data.length
    if (n === 0) return "返回空列表"
    const first = data[0] as any
    if (first?.instId && first?.last) return `返回 ${n} 个产品行情`
    if (first?.instId && first?.pos) return `返回 ${n} 个持仓`
    if (first?.ccy) return `返回 ${n} 个币种信息`
    if (first?.ordId) return `返回 ${n} 笔订单`
    if (first?.ts) return `返回 ${n} 条时间序列数据`
    if (first?.name) return `返回 ${n} 条记录`
    return `返回 ${n} 条记录`
  }
  if (typeof data === "object" && data !== null) {
    const d = data as any
    if (d.ok === true && d.message) return d.message as string
    if (d._summary) return undefined // 已有，不覆盖
    if (d.data && Array.isArray(d.data)) return `返回 ${d.data.length} 条记录`
  }
  return undefined
}

export function toResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  // 自动注入 _summary
  if (Array.isArray(data)) {
    const summary = autoSummary(data)
    const wrapper: any = { list: data }
    if (summary) wrapper._summary = summary
    return { content: [{ type: "text", text: JSON.stringify(wrapper, null, 2) }] }
  }
  if (typeof data === "object" && data !== null && !(data as any)._summary) {
    const summary = autoSummary(data)
    if (summary) {
      const enriched = { _summary: summary, ...(data as any) }
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] }
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

// ── 错误分类 + 中文消息映射 ────────────────────────────────────────────────

type ErrorCategory = "BUSINESS" | "AUTH" | "VALIDATION" | "NETWORK" | "RATE_LIMIT"

/** OKX REST + WS 错误码 → 中文消息。Agent 可直接转述给用户 */
const OKX_ERROR_MESSAGES: Record<number, string> = {
  // 公共 / 系统
  50000: "系统内部错误",
  50001: "系统繁忙，请稍后重试",
  50002: "系统升级维护中",
  50004: "请求超时",
  50005: "接口已被冻结，请联系客服",
  50006: "OK-ACCESS-KEY 无效",
  50007: "OK-ACCESS-SIGN 签名错误",
  50008: "OK-ACCESS-TIMESTAMP 时间戳无效",
  50009: "OK-ACCESS-PASSPHRASE 密码短语错误",
  50010: "当前 IP 不在 API Key 白名单中",
  50011: "请求频率过快，已触发限流。请降低请求速率",
  50012: "系统繁忙，请稍后重试",
  50013: "系统错误",
  50014: "参数校验失败，请检查必填字段和格式",
  50015: "仓位已被冻结",
  50016: "账户已被冻结",
  50017: "账户已被暂停",
  50018: "账户等级不足",
  50019: "合约已到期",
  50020: "余额不足",
  50021: "保证金不足",
  50022: "下单数量小于最小限制",
  50023: "下单数量超过最大限制",
  50024: "持仓数量已达上限",
  50025: "挂单数量已达上限",
  50026: "下单价格超出限价范围",
  50027: "价格精度不符合要求",
  50028: "数量精度不符合要求",
  50029: "该合约暂不可用",
  50030: "API Key 无此操作权限",
  50031: "API Key 已过期",
  50032: "API Key 未找到",
  50033: "API Key 未激活",
  50035: "触发风控规则，交易被拒绝",
  50036: "无交易权限",
  50044: "订单不存在",
  50045: "该订单不可撤销",
  50046: "订单已全部成交",
  50047: "订单已被撤销",
  50050: "持仓不存在",
  50051: "仓位已平仓",
  50053: "仓位保证金不足",
  50056: "下单过于频繁",
  50058: "该币种暂不支持",
  50059: "参数解析失败",
  50060: "账户模式不支持此操作",
  50061: "子账户请求频率超限",
  50064: "该合约不支持此操作",
  50068: "系统升级中，暂不可用",
  50070: "持仓模式不匹配",
  50071: "保证金模式不匹配",
  50072: "杠杆倍数超出允许范围",
  50074: "触发价格无效",
  50080: "下单价格偏离市场价过大",
  50082: "账户权益不足",
  // API Key 相关
  50100: "API Key 已被冻结",
  50101: "API Key 已过期",
  50102: "请求时间戳与服务器时间偏差超过 30 秒",
  50103: "请求头 OK-ACCESS-KEY 不能为空",
  50104: "请求头 OK-ACCESS-SIGN 签名不能为空",
  50105: "请求头 OK-ACCESS-TIMESTAMP 不能为空",
  50106: "请求头 OK-ACCESS-PASSPHRASE 不能为空",
  50107: "API Key 对应的账户不存在",
  50108: "账户余额不足",
  50109: "划转金额超过限额",
  50110: "划转币种不支持",
  50111: "划转失败",
  50120: "API Key 权限不足，请检查是否开通了所需权限（读取/交易/提现）",
  50121: "API Key 已过期",
  50122: "API Key 未找到",
  50123: "API Key 未激活",
  50124: "API Key 已被删除",
  50125: "API Key 已被冻结",
  50126: "API Key 已被禁用",
  // 交易
  51000: "参数错误，请检查必填参数",
  51001: "订单类型不支持",
  51002: "订单方向不支持",
  51003: "订单数量不能为 0 或负数",
  51004: "订单价格不能为 0 或负数",
  51005: "保证金模式不支持",
  51006: "订单价格超出限价范围",
  51007: "订单数量精度不符合要求",
  51008: "订单价格精度不符合要求",
  51009: "订单数量超出最大限制",
  51010: "订单数量低于最小限制",
  51011: "该产品不支持此订单类型",
  51012: "该产品不支持此保证金模式",
  51013: "该产品不支持此持仓模式",
  51014: "当前持仓模式不允许此操作",
  51015: "当前账户模式不允许此操作",
  51020: "批量下单数量超过上限",
  51021: "批量操作中包含重复订单",
  51026: "订单价格超出滑点保护范围",
  51027: "订单已过期",
  51100: "该产品不在可交易列表",
  51102: "持仓模式不匹配，无法平仓",
  51103: "保证金模式不匹配，无法平仓",
  51104: "杠杆倍数不匹配",
  51107: "市价单当前不可用",
  51108: "止损单当前不可用",
  // 资金
  52000: "划转失败",
  52001: "提现金额超过限额",
  52002: "提现地址无效",
  52003: "提现链不支持",
  52004: "提现网络费不足",
  52005: "提现已冻结",
  52006: "充值地址生成失败",
  52007: "该币种不支持充值",
  52008: "该币种不支持提现",
  // 跟单交易
  52100: "交易员不存在",
  52101: "交易员不对外公开",
  52102: "跟单金额超出限制",
  52103: "跟单人数已达上限",
  52104: "当前不支持跟单该交易员",
  52105: "该交易员已停止带单",
  // 策略 / 网格
  53000: "策略委托创建失败",
  53001: "策略委托修改失败",
  53002: "策略委托撤销失败",
  53003: "策略委托不存在",
  53004: "策略委托已触发",
  53005: "网格策略创建失败",
  53006: "网格策略不存在",
  53007: "网格策略已停止",
  53008: "网格参数无效",
  // WebSocket
  60001: "订阅频道不存在或参数错误",
  60002: "WebSocket 登录失败，请检查 API Key",
  60003: "WebSocket 订阅参数无效",
  60004: "WebSocket 请求频率过高",
  60005: "WebSocket 连接数已达上限",
  60006: "WebSocket 连接被服务端关闭",
  60007: "WebSocket 该频道需要登录",
  60008: "WebSocket 该频道不需要登录",
  60009: "WebSocket 登录已过期，请重新登录",
  64008: "服务升级中，连接即将关闭，请重连",
}

function translateError(code: number, rawMsg: string): string {
  const translated = OKX_ERROR_MESSAGES[code]
  if (translated) return translated
  // 通用分类回退
  if (code >= 50000 && code < 50100) return `系统/认证错误 (${code}): ${rawMsg}`
  if (code >= 50100 && code < 50200) return `API Key 错误 (${code}): ${rawMsg}`
  if (code >= 51000 && code < 51200) return `交易参数错误 (${code}): ${rawMsg}`
  if (code >= 52000 && code < 52200) return `资金/跟单错误 (${code}): ${rawMsg}`
  if (code >= 53000 && code < 54000) return `策略委托错误 (${code}): ${rawMsg}`
  if (code >= 60000 && code < 65000) return `WebSocket 错误 (${code}): ${rawMsg}`
  return rawMsg
}

function classifyError(msg: string): { errorCode: string; errorCategory: ErrorCategory; errorMessage: string } {
  // OKX API 错误码匹配: "OKX 50011: 请求频率过快..."
  const okxMatch = msg.match(/OKX (\d+):/)
  if (okxMatch && okxMatch[1]) {
    const code = parseInt(okxMatch[1])
    const rawMsg = msg.replace(/^OKX \d+: /, "")
    const translated = translateError(code, rawMsg)

    if (code >= 50000 && code < 50100) return { errorCode: `OKX_${code}`, errorCategory: "AUTH", errorMessage: translated }
    if (code === 50100 || code === 50101 || code === 50120) return { errorCode: `OKX_${code}`, errorCategory: "AUTH", errorMessage: translated }
    if (code >= 50004 && code <= 50014) return { errorCode: `OKX_${code}`, errorCategory: "VALIDATION", errorMessage: translated }
    if (code >= 51000 && code < 51200) return { errorCode: `OKX_${code}`, errorCategory: "VALIDATION", errorMessage: translated }
    return { errorCode: `OKX_${code}`, errorCategory: "BUSINESS", errorMessage: translated }
  }
  // HTTP 错误
  if (msg.startsWith("HTTP ")) {
    const httpMatch = msg.match(/HTTP (\d+)/)
    const status = httpMatch && httpMatch[1] ? parseInt(httpMatch[1]) : 0
    if (status === 401 || status === 403) return { errorCode: "HTTP_401", errorCategory: "AUTH", errorMessage: "API Key 认证失败，请检查密钥是否正确配置" }
    if (status === 429) return { errorCode: "HTTP_429", errorCategory: "RATE_LIMIT", errorMessage: "请求过于频繁，已触发限流。请稍等后重试" }
    return { errorCode: "NETWORK_ERROR", errorCategory: "NETWORK", errorMessage: `网络错误 HTTP ${status}` }
  }
  // AUTH_REQUIRED 消息
  if (msg.includes("API Key")) return { errorCode: "AUTH_REQUIRED", errorCategory: "AUTH", errorMessage: msg }
  // 默认
  return { errorCode: "UNKNOWN_ERROR", errorCategory: "BUSINESS", errorMessage: msg }
}

// ── 工具风险分级（只读模式 + 权限感知注册用） ────────────────────────────

export type RiskLevel = "READ" | "WRITE" | "FUND_TRANSFER" | "ADMIN"

/**
 * 结构化注册工具 — 描述前注入 [L:READ] 标记，classifyRisk 可直接解析。
 * Agent 调用 server.tool() 的地方全部替换为本函数。
 */
// ── 工具调用统计埋点 ──────────────────────────────────────────────────

export interface ToolStat {
  count: number
  lastCalled: number
  errors: number
  totalMs: number
}

export const toolStats = new Map<string, ToolStat>()

function recordToolCall(name: string, ms: number, success: boolean): void {
  const s = toolStats.get(name) ?? { count: 0, lastCalled: 0, errors: 0, totalMs: 0 }
  s.count++
  s.lastCalled = Date.now()
  s.totalMs += ms
  if (!success) s.errors++
  toolStats.set(name, s)
}

export function registerTool(
  server: McpServer,
  name: string,
  accessLevel: RiskLevel,
  description: string,
  paramsSchema: Record<string, unknown>,
  callback: (...args: any[]) => any,
): void {
  const taggedDesc = `[L:${accessLevel}] ${description}`
  const wrappedCallback = async (...args: any[]) => {
    const start = Date.now()
    try {
      const result = await callback(...args)
      recordToolCall(name, Date.now() - start, true)
      return result
    } catch (e) {
      recordToolCall(name, Date.now() - start, false)
      throw e
    }
  }
  server.tool(name, taggedDesc, paramsSchema, wrappedCallback)
}

/** 从描述中提取 [L:READ] 标记，有则直接返回，无则回退到名称推断 */
export function classifyRisk(toolNameOrDesc: string): RiskLevel {
  const m = toolNameOrDesc.match(/\[L:(READ|WRITE|FUND_TRANSFER|ADMIN)\]/)
  if (m) return m[1] as RiskLevel
  // 回退：旧工具未加 L: 标记时用名称推断
  const toolName = toolNameOrDesc
  // ── ADMIN：修改账户全局配置 ──
  const admin = ["okx_set_account_mode", "okx_set_position_mode", "okx_set_settle_currency"]
  if (admin.includes(toolName)) return "ADMIN"

  // ── FUND_TRANSFER：真实资金移动 ──
  const fund = ["okx_withdrawal", "okx_predictions_redeem"]
  if (fund.some(p => toolName.startsWith(p))) return "FUND_TRANSFER"

  // ── WRITE：产生交易/修改状态 ──
  const writePrefixes = [
    "okx_place_", "okx_cancel_", "okx_amend_", "okx_create_",
    "okx_stop_", "okx_close_", "okx_batch_", "okx_set_",
    "okx_transfer", "okx_borrow", "okx_repay",
    "okx_convert_trade", "okx_preset_", "okx_activate_",
    "okx_move_", "okx_copy_", "okx_first_",
    "okx_one_click_", "okx_easy_convert",
    "okx_mass_cancel", "okx_subaccount_set_",
    "okx_event_place_", "okx_event_cancel_", "okx_event_amend_",
    "okx_predictions_place_", "okx_predictions_cancel_",
    "okx_predictions_split", "okx_predictions_merge",
    "agent_quick_trade",
  ]
  if (writePrefixes.some(p => toolName.startsWith(p))) return "WRITE"

  // ── 特殊：模拟/预检 虽是 agent 工具但只读 ──
  const readSpecials = [
    "agent_simulate_order", "okx_preflight_check",
    "agent_catalog", "agent_catalog_detail", "agent_hub_status",
    "agent_hub_dispatch", "agent_hub_review", "agent_room_send", "agent_room_view",
    "okx_ws_subscribe", "okx_ws_subscribe_private", "okx_ws_events", "okx_ws_status", "okx_ws_close",
    "okx_predictions_ws_subscribe", "okx_predictions_ws_unsubscribe",
    "okx_predictions_ws_events", "okx_predictions_ws_status",
    "xlayer_subscribe", "xlayer_get_events", "xlayer_unsubscribe",
    "codegraph_status", "codegraph_query",
    "agent_get_preference",
    "agent_simulate_transfer", "agent_read_only_trade",
    "okx_event_instruments",
  ]
  if (readSpecials.includes(toolName)) return "READ"

  // ── 反馈/偏好写入虽是 agent 工具，但有磁盘写入副作用 ──
  if (["okx_agent_feedback", "agent_set_preference"].includes(toolName)) return "WRITE"

  // ── X Layer 写操作 ──
  if (toolName.startsWith("xlayer_call")) return "WRITE"

  return "READ"
}

export function toError(e: unknown): {
  content: [{ type: "text"; text: string }]
  isError: true
  errorCode: string
  errorCategory: ErrorCategory
  errorMessage: string
} {
  const msg = e instanceof Error ? e.message : String(e)
  const { errorCode, errorCategory, errorMessage } = classifyError(msg)
  return {
    content: [{ type: "text", text: errorMessage }],
    isError: true,
    errorCode,
    errorCategory,
    errorMessage,
  }
}
