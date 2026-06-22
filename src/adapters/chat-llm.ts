/**
 * 聊天助手 LLM 引擎
 *
 * 精选 20 个高频 MCP 工具（行情/指标/账户/交易），通过 MCP proxy 执行。
 * 流式调用 Anthropic SDK（DeepSeek 兼容端点或 Anthropic 直连）。
 */

import Anthropic from "@anthropic-ai/sdk"
import type { Tool, MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages"
import { logger } from "../utils/logger.js"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

// 确保 .env 在模块初始化前加载
const envPath = join(process.cwd(), ".env")
if (existsSync(envPath)) {
  readFileSync(envPath, "utf-8").split(/\r?\n/).forEach(line => {
    const hashIdx = line.indexOf("#")
    if (hashIdx >= 0) line = line.substring(0, hashIdx)
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/)
    if (m) {
      const val = m[2].trim()
      if (!val) { delete process.env[m[1]] }
      else if (!process.env[m[1]]) { process.env[m[1]] = val }
    }
  })
}

const log = logger("ChatLLM")

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: "user" | "assistant" | "tool"
  content?: string | null
  tool_calls?: { id: string; name: string; arguments: string }[]
  tool_call_id?: string
}

export interface ChatEvent {
  type: "text" | "tool_start" | "tool_end" | "done" | "error"
  delta?: string
  toolId?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolDuration?: number
  toolError?: string
  text?: string
  tokens?: { input: number; output: number }
  model?: string
  message?: string
}

interface ToolDef {
  name: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] }
}

// ═══════════════════════════════════════════════════════════════
// System Prompt
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `你是 hvip AI 交易助手。

核心原则：用户问什么你就答什么，不要自作主张。用户没提币种就别查行情，用户没说要分析就别写报告。

规则：
1. 严格按用户问题执行。比如"帮我查ETH"→只查ETH；"你好"→只打招呼。
2. 只有用户明确问某个币的价格/行情时，才调用工具查询那个币。用户没说币种名，就不要查任何币。
3. 查实时数据必须调工具，严禁编造数字。
4. 回答简洁，中文，一针见血。不要每次都写长篇分析报告。
5. 涉及金额用 USD 计价。
6. 下单前必须告知价格并确认。`

// ═══════════════════════════════════════════════════════════════
// 精选 20 个高频工具（静态定义，不依赖 MCP tools/list）
// ═══════════════════════════════════════════════════════════════

const CURATED_TOOLS: ToolDef[] = [
  {
    name: "okx_get_ticker",
    description: "查询单个产品实时行情：最新价/24h最高/24h最低/成交量/涨跌幅。查任意币种实时价格时必用。",
    inputSchema: { type: "object", properties: { instId: { type: "string", description: "产品ID，如BTC-USDT" } }, required: ["instId"] },
  },
  {
    name: "okx_quick_market",
    description: "单产品综合行情：最新价+买卖深度+资金费率。比分别调用多个工具更快。",
    inputSchema: { type: "object", properties: { instId: { type: "string", description: "如BTC-USDT-SWAP" } }, required: ["instId"] },
  },
  {
    name: "okx_get_funding_rate",
    description: "获取永续合约当前资金费率。",
    inputSchema: { type: "object", properties: { instId: { type: "string" } }, required: ["instId"] },
  },
  {
    name: "okx_get_candles",
    description: "获取K线(OHLCV)数据，用于技术分析、判断趋势。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, bar: { type: "string", description: "1m/5m/15m/1H/4H/1D" }, limit: { type: "number" } }, required: ["instId"] },
  },
  {
    name: "okx_indicator",
    description: "技术指标：RSI/MACD/布林带/EMA/SMA/ATR/超级趋势/形态识别等。分析超买超卖时必用。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, indicator: { type: "string", enum: ["rsi","macd","bb","atr","stoch","ema","sma","supertrend","pattern"] }, bar: { type: "string" } }, required: ["instId","indicator"] },
  },
  {
    name: "agent_market_sentiment",
    description: "市场情绪仪表盘(0-100)：多空比+PCR+成交量+OI+资金费率综合打分。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "agent_market_scan",
    description: "市场异动扫描：涨幅/跌幅/成交量异常/费率异常的币种。",
    inputSchema: { type: "object", properties: { sortBy: { type: "string", enum: ["change","vol","fundingRate"] }, topN: { type: "number" } }, required: [] },
  },
  {
    name: "okx_get_orderbook",
    description: "获取订单簿深度数据：买一卖一价格+深度档位。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, sz: { type: "number" } }, required: ["instId"] },
  },
  {
    name: "okx_get_instruments",
    description: "获取可用交易对列表。找交易对时使用。",
    inputSchema: { type: "object", properties: { instType: { type: "string", enum: ["SPOT","SWAP","FUTURES","OPTION"] } }, required: ["instType"] },
  },
  // ── 账户（需OKX Key）──
  {
    name: "okx_account_overview",
    description: "账户全景：总权益+各币种余额+全部持仓+账户配置。查仓位/余额时必用。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "okx_get_balance",
    description: "获取账户余额：各币种可用/冻结数量。",
    inputSchema: { type: "object", properties: { ccy: { type: "string", description: "币种，如USDT" } }, required: [] },
  },
  {
    name: "okx_get_positions",
    description: "获取当前持仓：数量/开仓价/标记价/未实现盈亏/杠杆率。",
    inputSchema: { type: "object", properties: { instType: { type: "string" }, instId: { type: "string" } }, required: [] },
  },
  {
    name: "agent_risk_overview",
    description: "风险仪表盘：保证金率/风险度/强平价格预估/持仓集中度。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  // ── 交易（需OKX Key）──
  {
    name: "okx_place_order",
    description: "下单交易：市价/限价，开多/开空/平多/平空。交易前务必确认用户意图。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, tdMode: { type: "string", enum: ["isolated","cross","cash"] }, side: { type: "string", enum: ["buy","sell"] }, ordType: { type: "string", enum: ["market","limit"] }, sz: { type: "string" }, posSide: { type: "string", enum: ["long","short"] } }, required: ["instId","tdMode","side","ordType","sz"] },
  },
  {
    name: "okx_get_order",
    description: "查询订单状态：是否成交/部分成交。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, ordId: { type: "string" } }, required: ["instId"] },
  },
  {
    name: "okx_cancel_order",
    description: "撤销未成交订单。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, ordId: { type: "string" } }, required: ["instId","ordId"] },
  },
  {
    name: "agent_quick_trade",
    description: "一键智能交易：自动查余额/算最大可开/查费率/下限价单。适合'买入0.1个'的场景。",
    inputSchema: { type: "object", properties: { instId: { type: "string" }, side: { type: "string", enum: ["buy","sell"] }, sz: { type: "string" }, posSide: { type: "string", enum: ["long","short"] }, tdMode: { type: "string", enum: ["isolated","cross"] } }, required: ["instId","side","sz"] },
  },
  // ── 资金 ──
  {
    name: "agent_funding_overview",
    description: "资金总览：各账户余额+最近资金流水。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  // ── 导航 ──
  {
    name: "agent_catalog",
    description: "全局工具导航——列出所有可用工具的分类。不确定用哪个工具时先调这个。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "okx_get_mark_price",
    description: "获取标记价格（合约强平参考价）。",
    inputSchema: { type: "object", properties: { instId: { type: "string" } }, required: ["instId"] },
  },
]

// ═══════════════════════════════════════════════════════════════
// ChatLLM
// ═══════════════════════════════════════════════════════════════

export class ChatLLM {
  private client: Anthropic | null = null
  private model: string
  private mcpUrl: string
  private tools: Tool[]

  constructor() {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_AUTH_TOKEN || ""
    const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic"

    if (apiKey) {
      this.client = new Anthropic({ apiKey, baseURL })
      log.info(`ChatLLM: DeepSeek @ ${baseURL}`)
    } else {
      const anthroKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || ""
      if (anthroKey) {
        this.client = new Anthropic({ apiKey: anthroKey })
        log.info("ChatLLM: Anthropic Direct")
      } else {
        log.error("ChatLLM: 未配置 LLM API Key")
      }
    }

    this.model = process.env.LLM_MODEL || "claude-sonnet-4-6"
    // Route through hub's own stable /mcp proxy (avoids MCP transport state issues)
    this.mcpUrl = "http://127.0.0.1:3100/mcp"

    // Build Anthropic tools once
    this.tools = CURATED_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
    log.info(`ChatLLM: ${this.tools.length} 个精选工具就绪`)
  }

  isAvailable(): boolean {
    return this.client !== null
  }

  // ── Tool execution via MCP proxy ───────────────────────────

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    userAuth?: { apiKey: string; secret: string; passphrase: string; isDemo?: boolean },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    }
    if (userAuth?.apiKey) {
      headers["X-OKX-Api-Key"] = userAuth.apiKey
      headers["X-OKX-Secret"] = userAuth.secret
      headers["X-OKX-Passphrase"] = userAuth.passphrase
      if (userAuth.isDemo) headers["X-OKX-Demo"] = "true"
    }

    const res = await fetch(this.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name, arguments: args },
        id: Date.now(),
      }),
    })

    const text = await res.text()
    if (!text) return { error: "数据服务暂不可用" }

    // Parse MCP SSE response — try multiple strategies
    let parsed: any = null

    // 1) Direct JSON (non-SSE)
    try { parsed = JSON.parse(text) } catch {}

    // 2) SSE: match each "data: {...}" line, try parsing from the last one
    if (!parsed) {
      const dataLines = text.split("\n").filter(l => l.startsWith("data: "))
      for (let i = dataLines.length - 1; i >= 0; i--) {
        const jsonStr = dataLines[i].slice(6)
        try { parsed = JSON.parse(jsonStr); break } catch {}
      }
    }

    if (!parsed) return { error: "数据服务暂不可用" }
    if (parsed.error) return { error: parsed.error.message || "服务异常" }

    let result = parsed.result?.content?.[0]?.text
    if (!result) result = parsed.result
    if (typeof result === "string") {
      try { result = JSON.parse(result) } catch {}
    }
    return result
  }

  // ── Streaming chat ─────────────────────────────────────────

  async *streamChat(opts: {
    messages: ChatMessage[]
    userAuth?: { apiKey: string; secret: string; passphrase: string; isDemo?: boolean }
    maxSteps?: number
  }): AsyncGenerator<ChatEvent> {
    if (!this.client) {
      yield { type: "error", message: "AI 服务暂未配置" }
      return
    }

    const { userAuth, maxSteps = 5 } = opts

    // Convert to Anthropic format
    const anthroMessages: MessageParam[] = []
    for (const msg of opts.messages) {
      if (msg.role === "user") {
        anthroMessages.push({ role: "user", content: msg.content || "" })
      } else if (msg.role === "assistant") {
        const content: any[] = []
        if (msg.content) content.push({ type: "text", text: msg.content })
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let input = {}
            try { input = JSON.parse(tc.arguments || "{}") } catch {}
            content.push({ type: "tool_use", id: tc.id, name: tc.name, input })
          }
        }
        anthroMessages.push({ role: "assistant", content: content.length ? content : msg.content || "" })
      } else if (msg.role === "tool" && msg.tool_call_id) {
        anthroMessages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content || "" }],
        })
      }
    }

    let totalInput = 0
    let totalOutput = 0
    let finalText = ""

    for (let step = 0; step < maxSteps; step++) {
      let toolUses: ToolUseBlock[] = []
      const textChunks: string[] = []

      try {
        // Streaming
        const stream = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          messages: anthroMessages,
          tools: this.tools,
          stream: true,
        })

        for await (const event of stream) {
          switch (event.type) {
            case "message_start":
              totalInput += event.message.usage.input_tokens
              break
            case "content_block_start":
              if (event.content_block.type === "tool_use") {
                toolUses.push(event.content_block as unknown as ToolUseBlock)
              }
              break
            case "content_block_delta":
              if (event.delta.type === "text_delta" && event.delta.text) {
                textChunks.push(event.delta.text)
                yield { type: "text", delta: event.delta.text }
              }
              break
            case "message_delta":
              totalOutput += event.usage.output_tokens
              break
          }
        }

        finalText += textChunks.join("")

        // No tool calls → done
        if (toolUses.length === 0) {
          yield {
            type: "done",
            text: finalText,
            tokens: { input: totalInput, output: totalOutput },
            model: this.model,
          }
          return
        }
      } catch (e: any) {
        yield { type: "error", message: e.message || "LLM 调用失败" }
        if (finalText) {
          yield { type: "done", text: finalText, tokens: { input: totalInput, output: totalOutput }, model: this.model }
        }
        return
      }

      // Re-fetch non-streaming for full tool_use blocks
      try {
        const complete = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          messages: anthroMessages,
          tools: this.tools,
          stream: false,
        })

        totalInput += complete.usage.input_tokens
        totalOutput += complete.usage.output_tokens

        const fullToolUses = complete.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
        if (fullToolUses.length === 0) break

        // Build assistant content
        const assistantContent: any[] = complete.content.map(b => {
          if (b.type === "text") return { type: "text" as const, text: b.text }
          if (b.type === "tool_use") return { type: "tool_use" as const, id: b.id, name: b.name, input: (b as ToolUseBlock).input }
          return { type: "text" as const, text: "" }
        })
        anthroMessages.push({ role: "assistant", content: assistantContent })

        // Execute tools sequentially
        const toolResults: any[] = []
        for (const tu of fullToolUses) {
          yield {
            type: "tool_start",
            toolId: tu.id,
            toolName: tu.name,
            toolInput: tu.input,
          }

          const startMs = Date.now()
          try {
            const result = await this.executeTool(tu.name, tu.input as Record<string, unknown>, userAuth)
            const duration = Date.now() - startMs
            const resultStr = typeof result === "string" ? result : JSON.stringify(result)

            yield { type: "tool_end", toolId: tu.id, toolName: tu.name, toolResult: result, toolDuration: duration }
            toolResults.push({ tool_use_id: tu.id, content: resultStr })
          } catch (e: any) {
            const duration = Date.now() - startMs
            const errMsg = e.message || String(e)
            yield { type: "tool_end", toolId: tu.id, toolName: tu.name, toolError: errMsg, toolDuration: duration }
            toolResults.push({ tool_use_id: tu.id, content: JSON.stringify({ error: errMsg }) })
          }
        }

        anthroMessages.push({ role: "user", content: toolResults.map(r => ({ type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content })) })
      } catch (e: any) {
        yield { type: "error", message: e.message || "LLM 调用失败" }
        if (finalText) {
          yield { type: "done", text: finalText, tokens: { input: totalInput, output: totalOutput }, model: this.model }
        }
        return
      }
    }

    yield { type: "done", text: finalText, tokens: { input: totalInput, output: totalOutput }, model: this.model }
  }
}

export const chatLLM = new ChatLLM()
