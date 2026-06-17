import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED , registerTool} from "./shared.js"
import { CATALOG as CATALOG_DATA } from "./agent-catalog-data.js"
import { DOMAIN_DETAILS as DOMAIN_DATA } from "./agent-domain-details.js"

// ── Agent 视角公共工具 ────────────────────────────────────────────────────────
//
// 这些工具的设计原则：
// 1. 错误信息必须是 Agent 可直接理解和转述的（不是堆栈跟踪）
// 2. 参数校验在入口完成，失败时告诉 Agent "哪里填错了、合法值是什么"
// 3. 每个返回都含 tsIso + _summary，Agent 无需二次加工
// 4. 并行调用所有不相互依赖的 API，减少往返时间

// ── 辅助：并行调用 + 统一错误收集 ─────────────────────────────────────────────

async function fetchAllSettled(fetchers: Record<string, Promise<unknown>>): Promise<{
  get: (name: string) => any
  errors: string[]
}> {
  const entries = Object.entries(fetchers)
  const keys = entries.map(e => e[0])
  const results = await Promise.allSettled(entries.map(e => e[1]))
  const errors: string[] = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const r = results[i]
      if (r.status === "rejected") {
        errors.push(`${keys[i]}: ${(r.reason as any)?.message ?? String(r.reason)}`)
      }
    }
  }
  const get = (name: string) => {
    const idx = keys.indexOf(name)
    if (idx < 0) return null
    const r = results[idx]
    if (r.status === "rejected") return null
    return (r as PromiseFulfilledResult<any>).value
  }
  return { get, errors }
}

// ── 辅助：从 instId 推断产品类型 ─────────────────────────────────────────────

function inferInstType(instId: string): string {
  const upper = instId.toUpperCase()
  if (upper.includes("-SWAP")) return "SWAP"
  if (upper.includes("-OPTION") || /-[\d]+-[CP]$/.test(upper)) return "OPTION"
  if (upper.includes("-FUTURES")) return "FUTURES"
  if (upper.includes("MARGIN")) return "MARGIN"
  // 交割合约（含日期如 BTC-USDT-250628）
  if (/-[\d]{6,}/.test(upper)) return "FUTURES"
  return "SPOT"
}

// ── 辅助：从 instId 推断计价/费用币种 ─────────────────────────────────────────

function inferFeeCcy(instId: string, tdMode: string): string {
  if (tdMode === "cash") {
    const parts = instId.split("-")
    return parts[1] || "USDT"
  }
  // 合约默认 USDT 计价
  return "USDT"
}

// ── 辅助：解析并校验数值参数（Agent 视角：带上下文错误信息） ─────────────────

function parseNumeric(val: string, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = parseFloat(val)
  if (isNaN(n) || !isFinite(n)) {
    return { ok: false, error: `参数 ${label}="${val}" 不是有效数字，Agent 请检查用户输入后重试` }
  }
  return { ok: true, value: n }
}

// ── 辅助：安全提取 orderbook 数据 ─────────────────────────────────────────────
// OKX API 返回 { code, data: [{ asks, bids, ts }] }，adapter 已解包 data 字段
// 所以 response 直接是 [{ asks, bids, ts }]

function extractOrderbook(raw: any): { asks: any[][]; bids: any[][] } {
  const item = Array.isArray(raw) ? raw[0] : raw
  if (!item) return { asks: [], bids: [] }
  return {
    asks: item.asks ?? [],
    bids: item.bids ?? [],
  }
}

export function registerAgentUtils(server: McpServer, auth: Auth | null): void {

  // ══════════════════════════════════════════════════════════════════════
  // okx_account_overview — 账户全景快照
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "okx_account_overview",
    "READ",
    "CAT:[系统] | ## 功能：一键获取账户全景：余额、持仓、配置、总估值，替代串行调用 4 个工具\n## 场景：用于Agent首次了解用户账户全貌、回答\"我账户现在什么情况\"、每日资产概览\n## 关键词：账户全景, 账户概览, account overview, 资产快照, 持仓汇总, 一键查账\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~3KB — 结构化摘要，非原始JSON堆砌\n## 关联：本工具全景 → okx_get_positions 深入单仓位 → okx_get_balance 看各币种 → okx_place_order 交易",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const { get, errors } = await fetchAllSettled({
          balance:   privateApi.getBalance(auth),
          positions: privateApi.getPositions(auth),
          config:    privateApi.getAccountConfig(auth),
          valuation: privateApi.getAssetValuation(auth),
        })

        // ── 余额摘要 ──
        const balanceData = (get("balance") as any[]) ?? []
        const totalEq = balanceData.length > 0 ? (balanceData[0] as any)?.totalEq : "N/A"
        const details = (balanceData.length > 0 ? (balanceData[0] as any)?.details ?? [] : []) as any[]
        const nonZero = details.filter((d: any) => parseFloat(d.availBal || d.cashBal || "0") > 0)
        const balanceSummary = nonZero.map((d: any) => ({
          ccy: d.ccy,
          equity: d.eq ?? d.cashBal,
          avail: d.availBal ?? d.cashBal,
          frozen: d.frozenBal ?? "0",
          upl: d.upl,
        }))

        // ── 持仓摘要 ──
        const posData = (get("positions") as any[]) ?? []
        const activePositions = posData.filter((p: any) =>
          parseFloat(p.avgPx || "0") > 0 || parseFloat(p.pos || "0") !== 0
        )
        const posSummary = activePositions.map((p: any) => ({
          instId: p.instId,
          posSide: p.posSide,
          pos: p.pos,
          avgPx: p.avgPx,
          markPx: p.markPx,
          upl: p.upl,
          uplRatio: p.uplRatio,
          lever: p.lever,
          margin: p.margin,
          liqPx: p.liqPx,
        }))

        // ── 账户配置 ──
        const cfgArr = (get("config") as any[]) ?? []
        const cfg = cfgArr[0] ?? {}

        // ── 总估值 ──
        const valArr = (get("valuation") as any[]) ?? []
        const val = valArr[0] ?? {}

        const overview = {
          tsIso: new Date().toISOString(),
          totalEquity: totalEq,
          totalValue: (val as any).totalBal ?? "N/A",
          valuationCurrency: (val as any).ccy ?? "USD",

          balance: {
            currencyCount: balanceSummary.length,
            currencies: balanceSummary.slice(0, 10), // top 10 非零币种
          },

          positions: {
            activeCount: posSummary.length,
            list: posSummary.slice(0, 20), // top 20
          },

          config: {
            acctLv: (cfg as any).acctLv,
            posMode: (cfg as any).posMode,
            autoLoan: (cfg as any).autoLoan,
          },

          errors,
        }

        return toResult(overview)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // okx_quick_market — 单产品市场速览
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "okx_quick_market",
    "READ",
    "CAT:[系统] | ## 功能：单次调用返回指定产品的行情+5档深度+资金费率+产品规格的结构化摘要\n## 场景：用于Agent回答\"现在BTC什么情况\"时一次拿到全部信息、快速判断交易时机\n## 关键词：市场速览, quick market, 行情+深度, 一键看盘, 综合行情, 市场概况\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT、ETH-USDT-SWAP\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB — 精简5档深度，非全量订单簿\n## 关联：本工具速览 → okx_get_candles 深入K线分析 → okx_get_orderbook 看全深度 → okx_place_order 下单",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP"),
    },
    async ({ instId }) => {
      try {
        const isSwap = instId.toUpperCase().includes("-SWAP")

        // 并行：行情 + 5档深度 + 费率（仅永续）
        const fetchers: Record<string, Promise<unknown>> = {
          ticker:   publicApi.getTicker(instId),
          orderbook: publicApi.getOrderbook(instId, 5),
        }
        if (isSwap) {
          fetchers.fundingRate = publicApi.getFundingRate(instId)
        }

        const { get, errors } = await fetchAllSettled(fetchers)

        // ── 行情 ──
        const tickerArr = (get("ticker") as any[]) ?? []
        const tk = tickerArr[0] ?? {}

        // ── 深度 ──
        const obRaw = get("orderbook")
        const { asks, bids } = extractOrderbook(obRaw)
        const spread = asks.length > 0 && bids.length > 0
          ? (parseFloat(asks[0]?.[0] ?? "0") - parseFloat(bids[0]?.[0] ?? "0")).toFixed(2)
          : "N/A"

        // ── 费率 ──
        let fundingRate: any = null
        if (isSwap) {
          const frArr = (get("fundingRate") as any[]) ?? []
          const fr = frArr[0] ?? {}
          fundingRate = {
            fundingRate: (fr as any).fundingRate,
            nextFundingTime: (fr as any).nextFundingTime
              ? new Date(parseInt((fr as any).nextFundingTime)).toISOString()
              : undefined,
          }
        }

        const isMargin = instId.toUpperCase().includes("MARGIN")

        const summary = {
          tsIso: new Date().toISOString(),
          instId,
          productType: isSwap ? "永续合约" : isMargin ? "杠杆" : "现货/其他",

          ticker: {
            last: (tk as any).last,
            bid: (tk as any).bidPx,
            ask: (tk as any).askPx,
            high24h: (tk as any).high24h,
            low24h: (tk as any).low24h,
            vol24h: (tk as any).vol24h,
            change24h: (tk as any).sodUtc8
              ? `${(tk as any).sodUtc8} (${(tk as any).sodUtc0 ?? "-"}%)`
              : undefined,
          },

          depth: {
            spread,
            top5Asks: asks.slice(0, 5).map((a: any) => ({ px: a[0], sz: a[1], orders: a[3] })),
            top5Bids: bids.slice(0, 5).map((b: any) => ({ px: b[0], sz: b[1], orders: b[3] })),
          },

          fundingRate,

          errors,
        }

        return toResult(summary)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // okx_preflight_check — 下单前预检
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "okx_preflight_check",
    "READ",
    "CAT:[系统] | ## 功能：下单前一次性检查：最大可开数量、限价范围、合约张数换算、当前价格，避免下单后报错\n## 场景：用于Agent下单前必调、验证用户输入的数量和价格是否合法、避免因参数错误被拒\n## 关键词：下单预检, preflight, 下单前检查, 数量换算, 限价检查, 可开检查\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - tdMode: 交易模式。cash=现货, cross=全仓, isolated=逐仓。必填\n##   - sz: 用户想下单的数量。必填（币数，会自动换算为张数）\n##   - px: 用户想下单的价格（选填，填了会检查是否在限价范围内）\n##   - side: 买卖方向。buy=买入, sell=卖出。填了会查对应方向的最大可开\n##   - ordType: 订单类型。填了会检查是否在限价范围内（限价单才需要）\n## 鉴权：⚠️ 需要 API Key（只读）- 只查询不产生订单\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具预检通过 → okx_place_order 下单 → okx_get_order 确认成交",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      tdMode:  z.enum(["cash","cross","isolated"]).describe("交易模式。cash=现货, cross=全仓, isolated=逐仓"),
      sz:      z.string().describe("用户想下单的数量（币数，会自动换算）"),
      px:      z.string().optional().describe("用户想下单的价格（选填）"),
      side:    z.enum(["buy","sell"]).optional().describe("买卖方向"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).optional().describe("订单类型"),
    },
    async ({ instId, tdMode, sz, px, side, ordType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        // ── 参数校验（Agent 视角：清晰的错误信息） ──
        const szParsed = parseNumeric(sz, "sz(数量)")
        if (!szParsed.ok) return toError(szParsed.error)
        if (szParsed.value <= 0) return toError(`数量 sz=${sz} 必须大于 0，Agent 请调整后重试`)
        if (px !== undefined) {
          const pxParsed = parseNumeric(px, "px(价格)")
          if (!pxParsed.ok) return toError(pxParsed.error)
          if (pxParsed.value <= 0) return toError(`价格 px=${px} 必须大于 0，Agent 请调整后重试`)
        }

        // 并行：最大可开 + 限价 + 合约换算 + 行情
        const { get, errors } = await fetchAllSettled({
          maxSize:     privateApi.getMaxSize(auth, instId, tdMode),
          priceLimit:  publicApi.getPriceLimitBatch("", undefined, instId),
          convertCoin: publicApi.convertContractCoin(instId, sz, "coin", "open"),
          ticker:      publicApi.getTicker(instId),
        })

        // ── 最大可开 ──
        const maxSizeArr = (get("maxSize") as any[]) ?? []
        const maxSz = maxSizeArr[0]

        // ── 限价 ──
        const limitArr = (get("priceLimit") as any[]) ?? []
        const limit = limitArr[0]

        // ── 合约换算 ──
        const convertArr = (get("convertCoin") as any[]) ?? []
        const converted = convertArr[0]

        // ── 当前价 ──
        const tickerArr = (get("ticker") as any[]) ?? []
        const tk = tickerArr[0] ?? {}

        // ── 组装结果 ──
        const checks: any = {
          tsIso: new Date().toISOString(),
          instId,
          tdMode,
          userInput: { sz, px, side, ordType },

          currentPrice: {
            last: (tk as any).last,
            bid: (tk as any).bidPx,
            ask: (tk as any).askPx,
          },

          maxSize: maxSz
            ? {
                maxBuy: (maxSz as any).maxBuy,
                maxSell: (maxSz as any).maxSell,
                ccy: (maxSz as any).ccy,
              }
            : null,

          priceLimit: limit
            ? {
                highest: (limit as any).highest,
                lowest: (limit as any).lowest,
                pxWithinLimit: px
                  ? szParsed.ok && parseFloat(px) >= parseFloat((limit as any).lowest ?? "0") &&
                    parseFloat(px) <= parseFloat((limit as any).highest ?? "Infinity")
                  : null,
              }
            : null,

          contractConversion: converted
            ? {
                fromCoin: sz,
                toContracts: (converted as any).sz,
                unit: "contracts",
              }
            : null,

          warnings: [] as string[],
          errors,
        }

        // ── 生成告警 ──
        if (limit && px !== undefined) {
          const lowest = parseFloat((limit as any).lowest ?? "0")
          const highest = parseFloat((limit as any).highest ?? "Infinity")
          const price = parseFloat(px)
          if (!isNaN(price) && price < lowest)
            checks.warnings.push(`价格 ${px} 低于下限 ${(limit as any).lowest}，Agent 请降低价格至 ≥${lowest}`)
          if (!isNaN(price) && price > highest)
            checks.warnings.push(`价格 ${px} 高于上限 ${(limit as any).highest}，Agent 请提高价格至 ≤${highest}`)
        }
        if (maxSz && side) {
          const maxBuy = parseFloat((maxSz as any).maxBuy ?? "0")
          const maxSell = parseFloat((maxSz as any).maxSell ?? "0")
          const qty = szParsed.value
          if (side === "buy" && qty > maxBuy)
            checks.warnings.push(`数量 ${sz} 超过最大可买 ${(maxSz as any).maxBuy}，Agent 请减至 ≤${maxBuy}`)
          if (side === "sell" && qty > maxSell)
            checks.warnings.push(`数量 ${sz} 超过最大可卖 ${(maxSz as any).maxSell}，Agent 请减至 ≤${maxSell}`)
        }
        if (converted) {
          const contractSz = (converted as any).sz
          if (parseFloat(contractSz ?? "0") < 1)
            checks.warnings.push(`换算后张数 ${contractSz} < 1，可能无法下单，Agent 请增加数量`)
        }

        checks.passed = checks.warnings.length === 0 && checks.errors.length === 0

        return toResult(checks)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // okx_agent_feedback — 反馈留言板
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "okx_agent_feedback",
    "READ",
    "CAT:[系统] | ## 功能：提交使用反馈——当你遇到多步操作烦琐、参数试错、不知道调用顺序、搜索不到工具、或需要使用手工计算弥补不足时，调用此工具记录下来\n## 场景：用于Agent汇报MCP工具的使用痛点，反馈将直接进入开发团队的待办列表，推动Skill组合和工具优化\n## 关键词：反馈, feedback, 留言, 建议, 痛点, 改善建议\n## 参数：\n##   - title: 一句话标题\n##   - what: 你做了什么操作\n##   - tools: 调用了哪些工具（用逗号分隔）\n##   - pain: 痛点是什么\n##   - suggestion: 你建议怎么改善（想要什么Skill）\n## 鉴权：PUBLIC — 无需 API Key，谁都可以反馈\n## 风险：READ — 只写日志，Agent 可随时调用\n## 返回量：微小 ~200B\n## 关联：任何工具组合遇到阻碍时调用 → 开发者审查反馈 → 创建 Skill 或优化工具",
    {
      title:      z.string().describe("一句话标题"),
      what:       z.string().describe("你做了什么操作"),
      tools:      z.string().describe("调用了哪些工具，用逗号分隔"),
      pain:       z.string().describe("痛点是什么"),
      suggestion: z.string().describe("你建议怎么改善，想要什么 Skill"),
    },
    async ({ title, what, tools, pain, suggestion }) => {
      try {
        // 固定日志目录（安全审计：不再从环境变量读取，防止路径注入）
        const logDir = path.join(os.homedir(), ".hvip")
        fs.mkdirSync(logDir, { recursive: true })
        const logFile = path.join(logDir, "hvip-mcp-feedback.log")
        // 日志轮转：超过 10MB 后重命名为 .1
        try {
          const stat = fs.statSync(logFile)
          if (stat.size > 10 * 1024 * 1024) {
            const rotated = logFile + ".1"
            if (fs.existsSync(rotated)) fs.unlinkSync(rotated)
            fs.renameSync(logFile, rotated)
          }
        } catch {}
        const entry = JSON.stringify({
          time: new Date().toISOString(),
          title, what, tools, pain, suggestion,
          host: os.hostname(),
        }) + "\n"
        fs.appendFileSync(logFile, entry, "utf-8")
        return toResult({ ok: true, saved: logFile, message: "反馈已记录，感谢！" })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_risk_overview — 风险仪表盘 (P0)
  // 替代: getBalance → getPositions → getAccountConfig → getMarkPrice → getFundingRate 串行5步
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_risk_overview",
    "READ",
    "CAT:[系统] | ## 功能：一键获取全仓风险仪表盘：持仓风险排序、总保证金率、强平预警、资金费率到期提醒\n## 场景：Agent 回答\"我现在风险多大\"、巡检所有持仓健康度、强平前预警通知\n## 关键词：风险, 强平, 保证金率, 风险排序, 健康度, risk, 风控\n## 参数：无\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：微小 ~2KB — 结构化风险摘要\n## 关联：本工具风险巡检 → 高风险仓位 agent_quick_trade 平仓 → agent_pnl_report 盈亏复盘",
    {},
    async () => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const { get, errors } = await fetchAllSettled({
          balance:   privateApi.getBalance(auth),
          positions: privateApi.getPositions(auth),
          config:    privateApi.getAccountConfig(auth),
        })

        const balOk = (get("balance") as any[]) ?? []
        const posOk = (get("positions") as any[]) ?? []
        const cfgArr = (get("config") as any[]) ?? []
        const cfgOk = cfgArr[0] ?? {}

        const totalEq = balOk.length > 0 ? parseFloat((balOk[0] as any)?.totalEq ?? "0") : 0
        const details = (balOk.length > 0 ? (balOk[0] as any)?.details ?? [] : []) as any[]

        // 持仓风险分析
        const activePos = posOk.filter((p: any) => parseFloat(p.pos || "0") !== 0)
        const posRisks = activePos.map((p: any) => {
          const margin = parseFloat(p.margin ?? p.imr ?? "0")
          const upl = parseFloat(p.upl ?? "0")
          const liqPx = parseFloat(p.liqPx ?? "0")
          const markPx = parseFloat(p.markPx ?? "0")
          const mgnRatio = parseFloat(p.mgnRatio ?? "0")
          const lever = parseFloat(p.lever ?? "0")
          // 距强平价的百分比距离
          let liqDistance = 100
          if (liqPx > 0 && markPx > 0) {
            liqDistance = p.posSide === "long"
              ? ((markPx - liqPx) / markPx) * 100
              : ((liqPx - markPx) / markPx) * 100
          }
          // mgnMode：取仓位值；若无则标记 unknown（不根据 posMode 猜测，posMode 与保证金模式是正交概念）
          const mgnMode = (p as any).mgnMode || "unknown"
          return {
            instId: p.instId,
            posSide: p.posSide,
            pos: p.pos,
            lever,
            margin: margin.toFixed(2),
            upl: upl.toFixed(2),
            uplRatio: p.uplRatio,
            markPx: p.markPx,
            liqPx: p.liqPx,
            mgnRatio: p.mgnRatio,
            liqDistance: liqDistance.toFixed(1) + "%",
            riskLevel: mgnRatio < 0.15 ? "🔴 危险" : mgnRatio < 0.3 ? "🟡 警告" : "🟢 安全",
            // 附操作上下文，让 Agent 不再二次查
            instFamily: p.instFamily,
            instType: p.instType,
            mgnMode,
          }
        }).sort((a: any, b: any) => parseFloat(a.mgnRatio) - parseFloat(b.mgnRatio))

        // 总风险汇总
        const totalMargin = posRisks.reduce((s: number, p: any) => s + parseFloat(p.margin), 0)
        const dangerCount = posRisks.filter((p: any) => p.riskLevel === "🔴 危险").length
        const warnCount = posRisks.filter((p: any) => p.riskLevel === "🟡 警告").length
        const unknownMgnCount = posRisks.filter((p: any) => p.mgnMode === "unknown").length

        // 保证金使用率
        const totalMgnRatio = totalEq > 0 ? (totalMargin / totalEq * 100).toFixed(1) : "N/A"

        // 资产币种简报
        const usdtDetail = details.find((d: any) => d.ccy === "USDT")
        const availBalance = usdtDetail ? parseFloat(usdtDetail.availBal ?? "0") : 0

        const overview = {
          tsIso: new Date().toISOString(),
          totalEquity: totalEq.toFixed(2),
          usedMargin: totalMargin.toFixed(2),
          marginRatio: totalMgnRatio + "%",
          availBalance: availBalance.toFixed(2),

          summary: {
            positionCount: posRisks.length,
            dangerCount,
            warnCount,
            safeCount: posRisks.length - dangerCount - warnCount,
            message: dangerCount > 0
              ? `⚠️ ${dangerCount} 个仓位接近强平！`
              : warnCount > 0
                ? `⚡ ${warnCount} 个仓位需要关注`
                : posRisks.length > 0
                  ? "✅ 所有仓位安全"
                  : "无持仓",
          },

          positions: posRisks,
          config: {
            posMode: (cfgOk as any).posMode,
            acctLv: (cfgOk as any).acctLv,
            autoLoan: (cfgOk as any).autoLoan,
          },

          errors,
          _notes: unknownMgnCount > 0
            ? `⚠️ ${unknownMgnCount} 个仓位未返回 mgnMode，平仓时 Agent 需单独确认保证金模式`
            : undefined,

          _summary: `当前${posRisks.length}个持仓，保证金${totalMargin.toFixed(2)} USD，总权益${totalEq.toFixed(2)} USD。${dangerCount > 0 ? `🔴 ${dangerCount}个仓位接近强平！` : warnCount > 0 ? `⚡ ${warnCount}个需关注` : posRisks.length > 0 ? `✅ 所有仓位安全` : `无持仓`}`,
        }

        return toResult(overview)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_quick_trade — 一步下单 (P0)
  // 替代: getBalance → getMaxSize → getFeeRates → convertContractCoin → placeOrder 串行5步
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_quick_trade",
    "WRITE",
    "CAT:[系统] | ## 功能：一步完成交易全流程——自动查余额、算最大可开、检查限价、下单，返回结构化交易确认\n## 场景：Agent 收到用户\"买入0.1 BTC\"时直接调用，无需分别调余额/可开/限价/下单\n## 关键词：一键交易, quick trade, 下单全流程, 自动检查, 一步到位\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP\n##   - side: buy=买入, sell=卖出\n##   - sz: 下单数量（币数或张数）\n##   - tdMode: cash=现货, cross=全仓, isolated=逐仓\n##   - px: 限价（选填，不填市价单）\n##   - ordType: 订单类型，默认limit\n## 鉴权：⚠️ 需要 API Key（交易权限）\n## 风险：WRITE — 真实下单，Agent 需用户确认后调用\n## 返回量：微小 ~1KB — 含预检结果+订单确认+风控提醒\n## 关联：agent_risk_overview 看风险 → 本工具下单 → okx_get_order 确认 → agent_pnl_report 复盘",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP"),
      side:    z.enum(["buy","sell"]).describe("买卖方向"),
      sz:      z.string().describe("下单数量（币数或张数）"),
      tdMode:  z.enum(["cash","cross","isolated"]).describe("交易模式"),
      px:      z.string().optional().describe("限价（选填，不填则市价）"),
      ordType: z.enum(["market","limit","post_only","fok","ioc"]).optional().describe("订单类型，默认limit"),
    },
    async ({ instId, side, sz, tdMode, px, ordType }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        // ── 参数校验（Agent 视角：清晰的错误信息） ──
        const szParsed = parseNumeric(sz, "sz(数量)")
        if (!szParsed.ok) return toError(szParsed.error)
        if (szParsed.value <= 0) return toError(`数量 sz=${sz} 必须大于 0，Agent 请调整后重试`)
        if (px !== undefined) {
          const pxParsed = parseNumeric(px, "px(价格)")
          if (!pxParsed.ok) return toError(pxParsed.error)
          if (pxParsed.value <= 0) return toError(`价格 px=${px} 必须大于 0，Agent 请调整后重试`)
        }

        // 推断产品类型（覆盖 SWAP/FUTURES/OPTION/MARGIN/SPOT）
        const instType = inferInstType(instId)
        const feeCcy = inferFeeCcy(instId, tdMode)

        // 并行预检：余额 + 最大可开 + 手续费 + 行情 + 限价
        const { get, errors: precheckErrors } = await fetchAllSettled({
          balance:    privateApi.getBalance(auth),
          maxSize:    privateApi.getMaxSize(auth, instId, tdMode),
          feeRates:   privateApi.getFeeRates(auth, instType, instId),
          ticker:     publicApi.getTicker(instId),
          priceLimit: publicApi.getPriceLimitBatch("", undefined, instId),
        })

        // 余额
        const balArr = (get("balance") as any[]) ?? []
        const balDetails = balArr[0]?.details ?? []
        const availBal = parseFloat((balDetails.find((d: any) => d.ccy === feeCcy) as any)?.availBal ?? "0")

        // 最大可开
        const maxArr = (get("maxSize") as any[]) ?? []
        const maxData = maxArr[0]
        const maxBuy = parseFloat(maxData?.maxBuy ?? "0")
        const maxSell = parseFloat(maxData?.maxSell ?? "0")
        const maxSz = side === "buy" ? maxBuy : maxSell

        // 手续费
        const feeArr = (get("feeRates") as any[]) ?? []
        const feeData = feeArr[0] ?? {}
        const makerFee = parseFloat(feeData?.maker ?? "0")
        const takerFee = parseFloat(feeData?.taker ?? "0")
        const feeRate = ordType === "market" ? takerFee : makerFee

        // 行情
        const tkArr = (get("ticker") as any[]) ?? []
        const tkData = tkArr[0] ?? {}
        const lastPx = parseFloat(tkData?.last ?? "0")
        const orderPx = px ? parseFloat(px) : lastPx
        const estCost = szParsed.value * orderPx
        const estFee = estCost * feeRate

        // 限价检查
        const limitArr = (get("priceLimit") as any[]) ?? []
        const limitData = limitArr[0]
        const lowest = parseFloat(limitData?.lowest ?? "0")
        const highest = parseFloat(limitData?.highest ?? "999999")

        // ── 预检告警 ──
        const warnings: string[] = []
        const qty = szParsed.value
        if (maxSz > 0 && qty > maxSz)
          warnings.push(`数量 ${sz} 超过最大可${side === "buy" ? "买" : "卖"} ${maxSz}，Agent 请减至 ≤${maxSz}`)
        if (availBal > 0 && availBal < estCost + estFee)
          warnings.push(`余额不足：需要 $${(estCost + estFee).toFixed(2)}，可用 $${availBal.toFixed(2)}，Agent 请减少数量或充值`)
        if (orderPx > 0 && (orderPx < lowest || orderPx > highest))
          warnings.push(`价格 ${orderPx} 超出限价范围 [${lowest}, ${highest}]，Agent 请调整价格`)

        if (warnings.length > 0 || precheckErrors.length > 0) {
          return toResult({
            tsIso: new Date().toISOString(),
            executed: false,
            precheck: {
              balance: availBal.toFixed(2),
              maxSize: { maxBuy, maxSell, maxForSide: maxSz },
              feeRate: (feeRate * 100).toFixed(4) + "%",
              estCost: estCost.toFixed(2),
              estFee: estFee.toFixed(4),
              priceCheck: { orderPx, lowest, highest, within: orderPx >= lowest && orderPx <= highest },
            },
            warnings: [...warnings, ...precheckErrors],
            tip: "预检未通过，请 Agent 根据以上 warnings 调整参数后重试",
          })
        }

        // 下单
        const body: Record<string, unknown> = { instId, side, sz, tdMode }
        if (ordType) body.ordType = ordType
        if (px) body.px = px
        const orderResult = await privateApi.placeOrder(auth, body) as any[]

        return toResult({
          tsIso: new Date().toISOString(),
          executed: true,
          order: orderResult?.[0] ?? orderResult,
          precheck: {
            balance: availBal.toFixed(2),
            maxSize: { maxBuy, maxSell, maxForSide: maxSz },
            feeRate: (feeRate * 100).toFixed(4) + "%",
            estCost: estCost.toFixed(2),
            estFee: estFee.toFixed(4),
          },
          risk: {
            marginUsed: availBal > 0 ? ((estCost / availBal) * 100).toFixed(1) + "%" : "N/A",
            warning: availBal > 0 && estCost / availBal > 0.3 ? "此单使用超过30%可用余额" : null,
          },
          _summary: `${side === "buy" ? "买入" : "卖出"} ${sz} ${instId} 已成交，预估成本 $${(estCost + estFee).toFixed(2)}，手续费 $${estFee.toFixed(4)}。保证金占用 ${availBal > 0 ? ((estCost / availBal) * 100).toFixed(1) + "%" : "N/A"}`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_market_scan — 市场扫描 (P1)
  // 替代: getTickers → 手动排序/过滤 → 逐个查费率/成交量 重复N次
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_market_scan",
    "READ",
    "CAT:[系统] | ## 功能：一键扫描市场异动——涨幅榜、跌幅榜、成交量异动、资金费率异常品种\n## 场景：Agent 回答\"今天有什么机会\"、发现暴涨暴跌、找费率套利目标\n## 关键词：市场扫描, 异动, 涨幅榜, 跌幅榜, 资金费率, 交易机会\n## 参数：\n##   - instType: 产品类型，默认SWAP\n##   - topN: 返回前N条，默认10\n##   - sortBy: 排序字段。change=涨跌幅, vol=成交量, fundingRate=资金费率\n## 鉴权：PUBLIC — 公开接口\n## 风险：READ — 只读查询\n## 返回量：微小 ~3KB — 仅返回topN\n## 关联：本工具扫描 → okx_quick_market 深入分析 → agent_quick_trade 下单",
    {
      instType: z.enum(["SPOT","SWAP","FUTURES"]).optional().describe("产品类型，默认SWAP"),
      topN:     z.number().int().min(3).max(50).optional().describe("返回条数，默认10"),
      sortBy:   z.enum(["change","vol","fundingRate"]).optional().describe("排序字段。change=涨跌幅, vol=24h成交量, fundingRate=资金费率(仅SWAP)"),
    },
    async ({ instType, topN, sortBy }) => {
      try {
        const it = instType || "SWAP"
        const n = topN || 10
        const sb = sortBy || "change"

        // 1) 获取全部 ticker
        const data = await publicApi.getTickers(it) as any[]
        const arr = data.map((t: any) => ({
          instId: t.instId,
          last: parseFloat(t.last ?? "0"),
          change24h: parseFloat(t.sodUtc8 ?? t.sodUtc0 ?? t.change24h ?? "0"),
          vol24h: parseFloat(t.vol24h ?? t.volCcy24h ?? "0"),
          high24h: parseFloat(t.high24h ?? "0"),
          low24h: parseFloat(t.low24h ?? "0"),
          bid: parseFloat(t.bidPx ?? "0"),
          ask: parseFloat(t.askPx ?? "0"),
          fundingRate: 0, // 稍后填充
        })).filter((t: any) => t.last > 0 && t.vol24h > 0)

        // 2) 排序 + 取 top
        if (sb === "vol") {
          arr.sort((a: any, b: any) => b.vol24h - a.vol24h)
        } else if (sb === "change") {
          arr.sort((a: any, b: any) => Math.abs(b.change24h) - Math.abs(a.change24h))
        } else if (sb === "fundingRate") {
          // 先按涨跌幅绝对值取 top 20 候选 → 并行查费率 → 按费率排序
          const candidates = [...arr].sort((a: any, b: any) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 20)
          const frFetchers: Record<string, Promise<unknown>> = {}
          for (const c of candidates) {
            frFetchers[c.instId] = publicApi.getFundingRate(c.instId)
          }
          const { get: frGet } = await fetchAllSettled(frFetchers)
          for (const c of candidates) {
            const frArr = (frGet(c.instId) as any[]) ?? []
            c.fundingRate = parseFloat(frArr[0]?.fundingRate ?? "0")
          }
          // 重排序 arr：有费率数据的排前面
          const frMap = new Map(candidates.map(c => [c.instId, c.fundingRate]))
          arr.forEach((t: any) => {
            t.fundingRate = frMap.get(t.instId) ?? 0
          })
          arr.sort((a: any, b: any) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
        }

        const top = arr.slice(0, n)

        // 3) 分类
        const gainers = top.filter((t: any) => t.change24h > 0).sort((a: any, b: any) => b.change24h - a.change24h)
        const losers = top.filter((t: any) => t.change24h < 0).sort((a: any, b: any) => a.change24h - b.change24h)
        const volumeLeader = [...arr].sort((a: any, b: any) => b.vol24h - a.vol24h).slice(0, 5)

        // 4) 资金费率异常（仅 SWAP）—— 提前到基础排序时就好，这里对 top 品种做快照
        let fundingAlerts: any[] = []
        if (it === "SWAP") {
          // 对 top 品种并行查询费率（如果 fundingRate 排序已查过，则复用）
          const toFetch = top.filter((t: any) => t.fundingRate === 0)
          if (toFetch.length > 0) {
            const frFetchers: Record<string, Promise<unknown>> = {}
            for (const t of toFetch) {
              frFetchers[t.instId] = publicApi.getFundingRate(t.instId)
            }
            const { get: frGet } = await fetchAllSettled(frFetchers)
            for (const t of toFetch) {
              const frArr = (frGet(t.instId) as any[]) ?? []
              t.fundingRate = parseFloat(frArr[0]?.fundingRate ?? "0")
            }
          }
          fundingAlerts = top
            .filter((t: any) => Math.abs(t.fundingRate) > 0.001)
            .map((t: any) => ({ instId: t.instId, fundingRate: (t.fundingRate * 100).toFixed(4) + "%" }))
        }

        return toResult({
          tsIso: new Date().toISOString(),
          scanType: sb === "fundingRate" ? "资金费率排行" : sb === "vol" ? "成交量排行" : "涨跌幅异动",
          instType: it,
          top: top.slice(0, n),
          gainers: gainers.slice(0, 5),
          losers: losers.slice(0, 5),
          volumeLeader,
          fundingAlerts,
          _summary: `共扫描${arr.length}个${it}品种。${sb === "fundingRate" ? `资金费率前${n}: ${top.slice(0, 3).map((t: any) => `${t.instId}(${(t.fundingRate * 100).toFixed(3)}%)`).join("、")}` : `涨幅前5: ${gainers.slice(0, 3).map((g: any) => g.instId).join("、") || "无"}。跌幅前5: ${losers.slice(0, 3).map((l: any) => l.instId).join("、") || "无"}`}。${fundingAlerts.length > 0 ? `⚠️ ${fundingAlerts.length}个品种资金费率异常。` : ""}`,
          tip: "扫描结果为快照。具体品种用 okx_quick_market 深入分析。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_pnl_report — 盈亏报告 (P2)
  // 替代: getFills → 手动汇总 → 按品种/日期分组计算 重复多次
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_pnl_report",
    "READ",
    "CAT:[系统] | ## 功能：一键生成盈亏报告——当前持仓浮动盈亏 + 近N日已实现盈亏汇总\n## 场景：Agent 回答\"今天我赚了多少\"、复盘交易绩效、生成每日盈亏报表\n## 关键词：盈亏, PnL, 盈亏报告, 浮动盈亏, 已实现盈亏, 交易复盘\n## 参数：\n##   - days: 统计天数，默认7（近7日已实现盈亏）\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询\n## 返回量：微小 ~2KB\n## 关联：agent_risk_overview 风险 → agent_quick_trade 交易 → 本工具复盘 → 调整策略",
    {
      days: z.number().int().min(1).max(90).optional().describe("统计天数，默认7"),
    },
    async ({ days }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const d = days || 7
        const { get, errors } = await fetchAllSettled({
          balance:   privateApi.getBalance(auth),
          positions: privateApi.getPositions(auth),
          fills:     privateApi.getFillsHistory(auth, undefined, undefined, Math.min(d * 10, 100)),
        })

        const balOk = (get("balance") as any[]) ?? []
        const balFirst = balOk[0] ?? {}
        const posOk = (get("positions") as any[]) ?? []
        const fillsOk = (get("fills") as any[]) ?? []

        // 浮动盈亏
        const totalUpl = posOk.reduce((s: number, p: any) => s + parseFloat(p.upl ?? "0"), 0).toFixed(2)
        const activePos = posOk.filter((p: any) => parseFloat(p.pos || "0") !== 0)
        const posPnL = activePos.map((p: any) => ({
          instId: p.instId,
          posSide: p.posSide,
          pos: p.pos,
          avgPx: p.avgPx,
          markPx: p.markPx,
          upl: parseFloat(p.upl || "0").toFixed(2),
          uplRatio: p.uplRatio,
        }))

        // 已实现盈亏：按日汇总
        const now = Date.now()
        const cutoff = now - d * 86400000
        const recentFills = fillsOk.filter((f: any) => {
          const ft = parseInt(f.ts || f.uTime || "0")
          return ft > cutoff
        })

        const dailyPnL: Record<string, number> = {}
        let totalRealized = 0
        for (const f of recentFills) {
          const ft = parseInt(f.ts || f.uTime || "0")
          const day = new Date(ft).toISOString().slice(0, 10)
          const pnl = parseFloat(f.pnl ?? f.fillPnl ?? "0")
          dailyPnL[day] = (dailyPnL[day] || 0) + pnl
          totalRealized += pnl
        }

        const totalEq = parseFloat((balFirst as any).totalEq ?? "0")

        return toResult({
          tsIso: new Date().toISOString(),
          period: `近${d}日`,
          totalEquity: totalEq.toFixed(2),
          floatingPnL: totalUpl,
          floatingPnLPercent: totalEq > 0 ? ((parseFloat(totalUpl) / totalEq) * 100).toFixed(2) + "%" : "N/A",
          realizedPnL: totalRealized.toFixed(2),
          realizedPnLPercent: totalEq > 0 ? ((totalRealized / totalEq) * 100).toFixed(2) + "%" : "N/A",
          dailyBreakdown: Object.entries(dailyPnL).map(([date, pnl]) => ({
            date, pnl: pnl.toFixed(2),
          })).sort((a, b) => b.date.localeCompare(a.date)),
          positions: posPnL,
          positionCount: activePos.length,
          tradesAnalyzed: recentFills.length,
          errors,
          _summary: `近${d}日浮动盈亏 $${totalUpl}（${totalEq > 0 ? ((parseFloat(totalUpl) / totalEq) * 100).toFixed(2) : "N/A"}%），已实现盈亏 $${totalRealized.toFixed(2)}。${activePos.length}个持仓，分析${recentFills.length}笔成交。`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_simulate_order — 模拟下单沙盒
  // 替代: getTicker → 手动估算滑点 → getFeeRates → 心算成本
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_simulate_order",
    "READ",
    "CAT:[系统] | ## 功能：模拟下单——不产生真实订单，返回预估成交价、滑点、手续费、资金占用\n## 场景：Agent 回答\"如果我现在买入0.1 BTC会怎样\"时使用，让用户在不冒风险的情况下了解交易成本\n## 关键词：模拟交易, 沙盒, simulate, 预估, 滑点, 手续费, 资金预估\n## 参数：\n##   - instId: 产品ID\n##   - side: buy=买入, sell=卖出\n##   - sz: 下单数量\n##   - tdMode: 交易模式\n##   - px: 限价（选填，用于计算限价单预估）\n## 鉴权：⚠️ 需要 API Key（只读，不产生订单）\n## 风险：READ — 只查询+计算，不产生真实订单\n## 返回量：微小 ~1KB\n## 关联：本工具模拟 → 用户确认 → agent_quick_trade 真实下单",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP"),
      side:   z.enum(["buy","sell"]).describe("买卖方向"),
      sz:     z.string().describe("下单数量"),
      tdMode: z.enum(["cash","cross","isolated"]).describe("交易模式"),
      px:     z.string().optional().describe("限价（选填，用于计算限价单预估）"),
    },
    async ({ instId, side, sz, tdMode, px }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        // ── 参数校验 ──
        const szParsed = parseNumeric(sz, "sz(数量)")
        if (!szParsed.ok) return toError(szParsed.error)
        if (szParsed.value <= 0) return toError(`数量 sz=${sz} 必须大于 0，Agent 请调整后重试`)
        if (px !== undefined) {
          const pxParsed = parseNumeric(px, "px(价格)")
          if (!pxParsed.ok) return toError(pxParsed.error)
        }

        const qty = szParsed.value
        const instType = inferInstType(instId)

        // 并行查询：行情 + 深度 + 手续费 + 限价
        const { get, errors } = await fetchAllSettled({
          ticker:     publicApi.getTicker(instId),
          orderbook:  publicApi.getOrderbook(instId, 10),
          feeRates:   privateApi.getFeeRates(auth, instType, instId),
          priceLimit: publicApi.getPriceLimitBatch("", undefined, instId),
        })

        // 行情
        const tkArr = (get("ticker") as any[]) ?? []
        const tk = tkArr[0] ?? {}
        const lastPx = parseFloat(tk?.last ?? "0")
        const bidPx = parseFloat(tk?.bidPx ?? "0")
        const askPx = parseFloat(tk?.askPx ?? "0")
        const markPx = lastPx || bidPx || askPx

        // 深度 — 计算滑点
        const obRaw = get("orderbook")
        const { asks, bids } = extractOrderbook(obRaw)
        let slippage = 0
        if (side === "buy" && asks.length > 0) {
          let remaining = qty
          let cost = 0
          for (const a of asks) {
            const px_a = parseFloat(a[0] || "0")
            const sz_a = parseFloat(a[1] || "0")
            const fill = Math.min(remaining, sz_a)
            cost += fill * px_a
            remaining -= fill
            if (remaining <= 0) break
          }
          const avgPx = cost / qty
          slippage = markPx > 0 ? ((avgPx - markPx) / markPx) * 100 : 0
        } else if (side === "sell" && bids.length > 0) {
          let remaining = qty
          let revenue = 0
          for (const b of bids) {
            const px_b = parseFloat(b[0] || "0")
            const sz_b = parseFloat(b[1] || "0")
            const fill = Math.min(remaining, sz_b)
            revenue += fill * px_b
            remaining -= fill
            if (remaining <= 0) break
          }
          const avgPx = revenue / qty
          slippage = markPx > 0 ? ((markPx - avgPx) / markPx) * 100 : 0
        }

        // 手续费
        const feeArr = (get("feeRates") as any[]) ?? []
        const feeData = feeArr[0] ?? {}
        const takerFee = parseFloat(feeData?.taker ?? "0")
        const feeRate = takerFee  // simulation 使用 taker rate（最坏情况）

        // 限价
        const limitArr = (get("priceLimit") as any[]) ?? []
        const limitData = limitArr[0]
        const lowest = parseFloat(limitData?.lowest ?? "0")
        const highest = parseFloat(limitData?.highest ?? "999999")

        const orderPx = px ? parseFloat(px) : (side === "buy" ? askPx : bidPx)
        const estCost = qty * orderPx
        const estFee = estCost * feeRate
        const pxWithinLimit = orderPx >= lowest && orderPx <= highest

        return toResult({
          tsIso: new Date().toISOString(),
          simulated: true,
          instId, side, sz, tdMode,
          orderPx: orderPx.toFixed(4),
          currentPrice: { last: lastPx, bid: bidPx, ask: askPx },
          estimate: {
            estCost: estCost.toFixed(2) + " USD",
            estFee: estFee.toFixed(4) + " USD",
            estTotal: (estCost + estFee).toFixed(2) + " USD",
            feeRate: (feeRate * 100).toFixed(4) + "%",
            slippage: slippage.toFixed(4) + "%",
          },
          priceCheck: {
            withinLimit: pxWithinLimit,
            range: `${lowest} ~ ${highest}`,
          },
          errors,
          _summary: `模拟${side === "buy" ? "买入" : "卖出"} ${sz} ${instId}：预估成交价 $${orderPx.toFixed(2)}，手续费 $${estFee.toFixed(4)}，合计 $${(estCost + estFee).toFixed(2)}，滑点 ${slippage.toFixed(2)}%。${pxWithinLimit ? "价格在限价范围内。" : "⚠️ 价格超出限价范围，Agent 请调整。"}`,
          tip: "以上为模拟结果，不产生真实订单。确认后可用 agent_quick_trade 真实下单。",
        })
      } catch (e) { return toError(e) }
    }
  )


  // ══════════════════════════════════════════════════════════════════════
  // Skill 1: agent_market_sentiment — 市场情绪综合分析（合并 sentiment + funding 扫描）
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_market_sentiment",
    "READ",
    "CAT:[市场扫描] | 市场情绪综合分析：多空比+PCR+资金费率+大户情绪→方向评分，或扫描极端费率套利机会",
    {
      mode: z.enum(["sentiment","funding"]).optional().default("sentiment").describe("sentiment=市场情绪评分, funding=资金费率异常扫描"),
      instType: z.enum(["SWAP","FUTURES","SPOT"]).optional().default("SWAP").describe("产品类型"),
      topN: z.number().int().min(5).max(50).optional().default(10).describe("分析品种数量"),
      sampleCcy: z.string().optional().describe("基准币种(BTC/ETH)，仅 sentiment 模式"),
      threshold: z.number().optional().default(0.001).describe("费率异常阈值，仅 funding 模式"),
    },
    async ({ mode, instType, topN, sampleCcy, threshold }) => {
      try {
        const type = instType || "SWAP"; const n = topN || 10
        const tickersAll = (await publicApi.getTickers(type)) as any[]
        const tickers = (tickersAll || []).slice(0, n)

        if (mode === "funding") {
          // ── 资金费率扫描模式 ──
          const fetchers: Record<string, Promise<unknown>> = {}
          for (const t of tickers) fetchers[t.instId] = publicApi.getFundingRate(t.instId)
          const { get, errors } = await fetchAllSettled(fetchers)
          const results = tickers.map((t: any) => {
            const fr = (get(t.instId) as any[])?.[0] || {}
            const rate = parseFloat(fr.fundingRate || "0")
            const annualized = rate * 365 * 3
            return {
              instId: t.instId, last: t.last,
              fundingRate: fr.fundingRate || "N/A",
              annualizedRate: `${(annualized * 100).toFixed(2)}%`,
              nextFundingTime: fr.nextFundingTime || "N/A",
              isExtreme: Math.abs(rate) > (threshold || 0.001),
              direction: rate > 0 ? "空头付多头" : "多头付空头",
              arbitrageHint: rate > (threshold || 0.001)
                ? `资金费率极高(${(annualized * 100).toFixed(0)}%年化)，现货买入+合约做空可套利`
                : rate < -(threshold || 0.001)
                  ? `资金费率极负，现货卖出+合约做多可套利`
                  : null,
            }
          }).sort((a, b) => Math.abs(parseFloat(b.fundingRate === "N/A" ? "0" : b.fundingRate)) - Math.abs(parseFloat(a.fundingRate === "N/A" ? "0" : a.fundingRate)))
          const opportunities = results.filter(r => r.isExtreme)
          return toResult({
            tsIso: new Date().toISOString(), mode, scanned: results.length,
            extremeCount: opportunities.length,
            threshold: `${((threshold || 0.001) * 365 * 3 * 100).toFixed(0)}% 年化`,
            topOpportunities: opportunities.slice(0, 10),
            allResults: results, errors,
            _summary: opportunities.length > 0
              ? `发现 ${opportunities.length} 个异常费率：${opportunities.slice(0, 3).map((o: any) => `${o.instId}(${o.annualizedRate})`).join(", ")}。`
              : `已扫描 ${results.length} 个品种，无极端费率。`,
          })
        }

        // ── 情绪评分模式 ──
        const ccy = sampleCcy || "BTC"
        const firstInstId = tickers[0]?.instId || "BTC-USDT-SWAP"

        // 并行拉取核心情绪指标
        const { get, errors } = await fetchAllSettled({
          lsRatio: publicApi.getLongShortRatio(ccy),
          pcr: publicApi.getOptionPutCallRatio(ccy),
          takerVol: publicApi.getTakerVolume(ccy, type),
          oi: publicApi.getOpenInterest(type),
          topLS: publicApi.getTopTraderLongShortRatio(firstInstId),
        })

        const lsData = ((get("lsRatio") as any[])?.[0] || {}) as any
        const pcrData = ((get("pcr") as any[])?.[0] || {}) as any
        const takerData = ((get("takerVol") as any[])?.[0] || {}) as any
        const oiData = get("oi") as any[]
        const topLSData = ((get("topLS") as any[])?.[0] || {}) as any

        // 并行获取所有品种资金费率
        const frFetchers: Record<string, Promise<unknown>> = {}
        for (const t of tickers) frFetchers[t.instId] = publicApi.getFundingRate(t.instId)
        const frResults = await fetchAllSettled(frFetchers)

        const perCoin = tickers.map((t: any) => {
          const frData = (frResults.get(t.instId) as any[])?.[0] || {}
          const rate = parseFloat(frData.fundingRate || "0")
          const changePct = t.open24h && t.last ? (parseFloat(t.last) - parseFloat(t.open24h)) / parseFloat(t.open24h) * 100 : 0
          let score = 0; const reasons: string[] = []
          if (rate > 0.0005) { score -= 1; reasons.push(`资金费率极高→偏空`) }
          else if (rate > 0.0001) { score -= 0.5; reasons.push(`费率偏高`) }
          else if (rate < -0.0005) { score += 1; reasons.push(`费率极负→偏多`) }
          if (changePct > 3) { score += 1; reasons.push(`24h涨${changePct.toFixed(1)}%`) }
          else if (changePct < -3) { score -= 1; reasons.push(`24h跌${Math.abs(changePct).toFixed(1)}%`) }
          return {
            instId: t.instId, last: t.last,
            change24h: `${changePct.toFixed(2)}%`,
            fundingRate: frData.fundingRate || "N/A",
            fundingRateAnnual: rate ? `${(rate * 365 * 3 * 100).toFixed(2)}%` : "N/A",
            sentimentScore: score,
            sentiment: score > 1 ? "🟢 偏多" : score < -1 ? "🔴 偏空" : "🟡 中性",
            reasons,
          }
        })

        let globalScore = 0
        const lsValue = parseFloat(lsData.longShortRatio || "1")
        if (lsValue > 1.2) globalScore += 1; else if (lsValue < 0.8) globalScore -= 1
        const pcrValue = parseFloat(pcrData.oiRatio || "1")
        if (pcrValue > 0.8) globalScore -= 1; else if (pcrValue < 0.5) globalScore += 1

        return toResult({
          tsIso: new Date().toISOString(), mode,
          globalSentiment: globalScore > 0 ? "🟢 偏向多头" : globalScore < 0 ? "🔴 偏向空头" : "🟡 中性",
          globalMetrics: {
            longShortRatio: lsData.longShortRatio || "N/A",
            putCallOiRatio: pcrData.oiRatio || "N/A",
            takerBuyVol: takerData.buyVol || "N/A", takerSellVol: takerData.sellVol || "N/A",
            contractTopLS: topLSData.longShortRatio || "N/A",
            openInterest: oiData.length > 0 ? (oiData[0] as any)?.oi : "N/A",
          },
          perCoin: perCoin.slice(0, n),
          errors,
          _summary: `${mode === "sentiment" ? "市场情绪" : "费率扫描"}：${perCoin.filter((c: any) => c.sentimentScore > 1).length} 个偏多，${perCoin.filter((c: any) => c.sentimentScore < -1).length} 个偏空。`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 2: agent_asset_center — 资产指挥中心（合并 fund + earn + subaccount）
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_asset_center",
    "READ",
    "CAT:[账户资产] | 资产指挥中心：资金分布、理财收益、子账户一览，三合一",
    {
      mode: z.enum(["all","funds","earn","subaccounts"]).optional().default("all").describe("all=全景, funds=资金分布与划转, earn=理财收益, subaccounts=子账户"),
      ccy: z.string().optional().describe("币种过滤，仅 funds 模式"),
      subMode: z.enum(["list","detail"]).optional().default("list").describe("子账户模式：list=列表, detail=含余额"),
    },
    async ({ mode, ccy, subMode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const fetchers: Record<string, Promise<unknown>> = {}
        if (mode === "all" || mode === "funds") {
          fetchers.funding = privateApi.getBalance_funding(auth, ccy)
          fetchers.trading = privateApi.getBalance(auth, ccy)
        }
        if (mode === "all" || mode === "earn") {
          fetchers.savings = privateApi.getSavingsBalance(auth)
          fetchers.ethStaking = privateApi.getEthStakingBalance(auth)
          fetchers.solStaking = privateApi.getSolStakingBalance(auth)
          fetchers.stableRewards = privateApi.getStableRewardsProductInfo(auth)
          fetchers.stakingOrders = privateApi.getStakingOrders(auth)
        }
        if (mode === "all" || mode === "subaccounts") {
          fetchers.subList = privateApi.listSubAccounts(auth)
        }
        const { get, errors } = await fetchAllSettled(fetchers)

        const result: any = { tsIso: new Date().toISOString(), mode, errors }

        // ── 资金分布 ──
        if (mode === "all" || mode === "funds") {
          const fundData = (get("funding") as any[])?.[0] || {}
          const tradeData = (get("trading") as any[])?.[0] || {}
          const fundDetails = (fundData.details || fundData.detail || []) as any[]
          const tradeDetails = (tradeData.details || tradeData.detail || []) as any[]
          const map = new Map<string, any>()
          for (const d of fundDetails) map.set(d.ccy, { ccy: d.ccy, fundingAvail: d.availBal || d.cashBal || "0", tradingAvail: "0" })
          for (const d of tradeDetails) {
            const e = map.get(d.ccy)
            if (e) e.tradingAvail = d.availBal || d.cashBal || "0"
            else map.set(d.ccy, { ccy: d.ccy, fundingAvail: "0", tradingAvail: d.availBal || d.cashBal || "0" })
          }
          result.funds = {
            fundingTotalEq: fundData.totalEq || "N/A",
            tradingTotalEq: tradeData.totalEq || "N/A",
            currencies: [...map.values()].filter((d: any) => parseFloat(d.fundingAvail) > 0 || parseFloat(d.tradingAvail) > 0),
          }
        }

        // ── 理财收益 ──
        if (mode === "all" || mode === "earn") {
          const savings = get("savings"); const eth = get("ethStaking"); const sol = get("solStaking")
          const earnProducts: any[] = []
          for (const arr of [savings, eth, sol]) {
            if (Array.isArray(arr)) for (const s of arr as any[]) earnProducts.push({
              ccy: s.ccy || "?", product: s.productId || s.investType || "earn",
              balance: s.amt || s.investAmt || "0", apy: s.rate || s.apy || "N/A",
            })
          }
          result.earn = {
            savingsCount: Array.isArray(savings) ? (savings as any[]).length : 0,
            ethStakingCount: Array.isArray(eth) ? (eth as any[]).length : 0,
            solStakingCount: Array.isArray(sol) ? (sol as any[]).length : 0,
            stakingOrderCount: Array.isArray(get("stakingOrders")) ? (get("stakingOrders") as any[]).length : 0,
            products: earnProducts,
          }
        }

        // ── 子账户 ──
        if (mode === "all" || mode === "subaccounts") {
          const subList = (get("subList") as any[]) || []
          if (subMode === "detail" && subList.length > 0) {
            const balFetchers: Record<string, Promise<unknown>> = {}
            for (const s of subList) balFetchers[s.subAcct] = privateApi.getSubAccountFundingBalance(auth, s.subAcct)
            const balRes = await fetchAllSettled(balFetchers)
            result.subaccounts = subList.map((s: any) => {
              const bal = (balRes.get(s.subAcct) as any[])?.[0] || {}
              return { subAcct: s.subAcct, label: s.label, totalEq: bal.totalEq || "N/A" }
            })
          } else {
            result.subaccounts = subList.map((s: any) => ({ subAcct: s.subAcct, label: s.label, enable: s.enable }))
          }
          result.subaccountCount = subList.length
        }

        // ── 汇总 ──
        const parts: string[] = []
        if (result.funds) parts.push(`资金账户${result.funds.currencies?.length || 0}个币种`)
        if (result.earn) parts.push(`理财${result.earn.products?.length || 0}个持仓`)
        if (result.subaccounts) parts.push(`${result.subaccountCount}个子账户`)
        result._summary = "资产全景：" + parts.join("，") + "。"

        return toResult(result)
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 3: agent_strategy_center — 策略交易中心（合并 dashboard + grid advisor）
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_strategy_center",
    "READ",
    "CAT:[策略交易] | 策略交易中心：活跃策略仪表盘 or 网格参数智能推荐",
    {
      mode: z.enum(["dashboard","grid_advice"]).default("dashboard").describe("dashboard=所有活跃策略一览, grid_advice=波动率分析+AI网格推荐"),
      instType: z.enum(["SPOT","SWAP","FUTURES"]).optional().describe("产品类型过滤"),
      instId: z.string().optional().describe("交易品种(grid_advice模式必填)，如 BTC-USDT"),
      direction: z.enum(["long","short","neutral"]).optional().default("neutral").describe("网格方向(grid_advice)"),
    },
    async ({ mode, instType, instId, direction }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        if (mode === "grid_advice") {
          // ── 网格策略顾问 ──
          if (!instId) return toError(new Error("grid_advice 模式需要 instId 参数"))
          const { get, errors } = await fetchAllSettled({
            aiParam: publicApi.getGridAiParam(instId, "grid"),
            candles: publicApi.getCandles(instId, "1D", 30),
            ticker: publicApi.getTicker(instId),
          })
          const aiParam = ((get("aiParam") as any[])?.[0] || {}) as any
          const candles = (get("candles") as any[][]) || []
          const tickerData = ((get("ticker") as any[])?.[0] || {}) as any
          const closes = candles.map((c: any[]) => parseFloat(c[4] || "0")).filter((n: number) => n > 0)
          let volatility = 0
          if (closes.length >= 2) {
            const returns = closes.slice(1).map((c: number, i: number) => (c - closes[i]) / closes[i])
            const mean = returns.reduce((a: number, b: number) => a + b, 0) / returns.length
            volatility = Math.sqrt(returns.reduce((a: number, r: number) => a + (r - mean) ** 2, 0) / returns.length) * Math.sqrt(365)
          }
          const lastPrice = parseFloat(tickerData.last || "0")
          const high30 = closes.length > 0 ? Math.max(...closes) : lastPrice * 1.1
          const low30 = closes.length > 0 ? Math.min(...closes) : lastPrice * 0.9
          const gUpper = aiParam.upperPx || (high30 * 1.05).toFixed(2)
          const gLower = aiParam.lowerPx || (low30 * 0.95).toFixed(2)
          const gCount = aiParam.gridNum || Math.min(20, Math.floor((parseFloat(String(gUpper)) - parseFloat(String(gLower))) / (lastPrice * 0.01)) || 10)
          return toResult({
            tsIso: new Date().toISOString(), mode, instId, currentPrice: lastPrice,
            volatility: `${(volatility * 100).toFixed(1)}%`,
            range30d: { high: high30, low: low30 },
            recommendation: { direction: direction || "neutral", upperPrice: gUpper, lowerPrice: gLower, gridCount: gCount },
            errors,
            _summary: `${instId} 30日年化波动率 ${(volatility * 100).toFixed(1)}%。AI推荐网格 [${gLower}, ${gUpper}]，${gCount} 档。`,
            tip: "确认后用 okx_create_grid_order 创建网格。",
          })
        }

        // ── 策略仪表盘 ──
        const { get, errors } = await fetchAllSettled({
          algoOrders: privateApi.getOrdersAlgoPending(auth, undefined, instType || undefined),
          gridOrders: privateApi.getGridOrdersPending(auth),
          recurringOrders: privateApi.getRecurringOrdersPending(auth),
          signalBots: privateApi.getSignalBotsPending(auth, instType || undefined),
          spreadOrders: privateApi.getSpreadOrdersPending(auth),
        })
        const counts = {
          algo: Array.isArray(get("algoOrders")) ? (get("algoOrders") as any[]).length : 0,
          grid: Array.isArray(get("gridOrders")) ? (get("gridOrders") as any[]).length : 0,
          recurring: Array.isArray(get("recurringOrders")) ? (get("recurringOrders") as any[]).length : 0,
          signal: Array.isArray(get("signalBots")) ? (get("signalBots") as any[]).length : 0,
          spread: Array.isArray(get("spreadOrders")) ? (get("spreadOrders") as any[]).length : 0,
        }
        const totalActive = Object.values(counts).reduce((a, b) => a + b, 0)
        return toResult({
          tsIso: new Date().toISOString(), mode, totalActive, breakdown: counts,
          details: {
            algoOrders: Array.isArray(get("algoOrders")) ? (get("algoOrders") as any[]).slice(0, 15).map((o: any) => ({ algoId: o.algoId, instId: o.instId, ordType: o.ordType, side: o.side, state: o.state })) : [],
            gridOrders: Array.isArray(get("gridOrders")) ? (get("gridOrders") as any[]).slice(0, 10).map((o: any) => ({ algoId: o.algoId, instId: o.instId, state: o.state })) : [],
            recurringOrders: Array.isArray(get("recurringOrders")) ? (get("recurringOrders") as any[]).slice(0, 10).map((o: any) => ({ algoId: o.algoId, instId: o.instId, period: o.period, state: o.state })) : [],
            signalBots: Array.isArray(get("signalBots")) ? (get("signalBots") as any[]).slice(0, 10).map((o: any) => ({ signalId: o.signalId || o.algoId, instId: o.instId, state: o.state })) : [],
            spreadOrders: Array.isArray(get("spreadOrders")) ? (get("spreadOrders") as any[]).slice(0, 10).map((o: any) => ({ algoId: o.algoId, sprdId: o.sprdId, state: o.state })) : [],
          },
          errors,
          _summary: totalActive > 0
            ? `活跃策略 ${totalActive} 个：条件委托 ${counts.algo} / 网格 ${counts.grid} / 定投 ${counts.recurring} / 信号 ${counts.signal} / 价差 ${counts.spread}`
            : "当前无活跃策略。",
          tip: "需要网格建议？用 mode=grid_advice。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 4: agent_stop_loss_master — 一键止损风控
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_stop_loss_master",
    "WRITE",
    "CAT:[风险风控] | 全局风控：批量设止损条件单 / 一键全部撤单 / 查看风控状态",
    {
      instId: z.string().optional().describe("指定品种，不填则对所有持仓操作"),
      stopLossPct: z.string().optional().describe("止损百分比，如 '5' 表示亏损 5% 止损"),
      mode: z.enum(["preview","set_stop_loss","cancel_all"]).describe("preview=查看风控状态, set_stop_loss=设止损单, cancel_all=全部撤单"),
    },
    async ({ instId, stopLossPct, mode }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const positions = (await privateApi.getPositions(auth)) as any[]
        const active = (positions || []).filter((p: any) =>
          parseFloat(p.avgPx || "0") > 0 && parseFloat(p.pos || "0") !== "0"
        )
        const targets = instId ? active.filter((p: any) => p.instId === instId) : active
        if (targets.length === 0) {
          return toResult({ tsIso: new Date().toISOString(), mode, message: instId ? `${instId} 无活跃持仓` : "无任何活跃持仓" })
        }
        if (mode === "preview") {
          const pct = parseFloat(stopLossPct || "5")
          return toResult({
            tsIso: new Date().toISOString(), mode,
            positions: targets.map((p: any) => ({
              instId: p.instId, posSide: p.posSide, pos: p.pos, avgPx: p.avgPx,
              markPx: p.markPx, upl: p.upl, uplRatio: p.uplRatio, liqPx: p.liqPx, lever: p.lever,
              suggestedStopPx: p.avgPx ? (p.posSide === "long"
                ? (parseFloat(p.avgPx) * (1 - pct / 100)).toFixed(2)
                : (parseFloat(p.avgPx) * (1 + pct / 100)).toFixed(2)) : "N/A",
            })),
            _summary: `风控预览：${targets.length} 个持仓，建议止损幅度 ${pct}%。`,
          })
        }
        if (mode === "set_stop_loss") {
          if (!stopLossPct) return toError(new Error("set_stop_loss 模式需要 stopLossPct 参数"))
          const pct = parseFloat(stopLossPct)
          if (isNaN(pct) || pct <= 0 || pct >= 50) return toError(new Error("stopLossPct 必须在 1-50 之间"))
          const actions: any[] = []
          for (const p of targets) {
            const avgPx = parseFloat(p.avgPx); const isLong = p.posSide === "long"
            const stopPx = isLong ? (avgPx * (1 - pct / 100)).toFixed(2) : (avgPx * (1 + pct / 100)).toFixed(2)
            try {
              await privateApi.placeAlgoOrder(auth, {
                instId: p.instId, tdMode: "cross",
                side: isLong ? "sell" : "buy", ordType: "conditional",
                sz: Math.abs(parseFloat(p.pos)).toString(), tpTriggerPx: stopPx, tpOrdPx: "-1",
              })
              actions.push({ instId: p.instId, posSide: p.posSide, stopPx, status: "placed" })
            } catch (e: any) {
              actions.push({ instId: p.instId, posSide: p.posSide, stopPx, status: "failed", error: e.message })
            }
          }
          return toResult({
            tsIso: new Date().toISOString(), mode, actions,
            _summary: `已为 ${actions.filter((a: any) => a.status === "placed").length}/${actions.length} 个持仓设止损（${stopLossPct}%）。`,
          })
        }
        // cancel_all
        await privateApi.massCancel(auth, instId ? "SWAP" : "SWAP")
        return toResult({ tsIso: new Date().toISOString(), mode, cancelled: true, _summary: "已全部撤单。" })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 5: agent_copy_trader_search — 智能跟单搜索
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_copy_trader_search",
    "READ",
    "CAT:[跟单] | 按收益率/胜率/回撤筛选最优带单员，附跟单指引",
    {
      instType: z.enum(["SPOT","SWAP"]).optional().default("SWAP"),
      sortBy: z.enum(["pnl","winRate","copyCount"]).optional().default("pnl"),
      topN: z.number().int().min(1).max(20).optional().default(10),
    },
    async ({ instType, sortBy, topN }) => {
      try {
        const type = instType || "SWAP"; const n = topN || 10
        const traders = await publicApi.getPublicLeadTraders(type) as any[]
        if (!Array.isArray(traders) || traders.length === 0) {
          return toResult({ tsIso: new Date().toISOString(), traders: [], _summary: "当前无可用带单员。" })
        }
        const batch = traders.slice(0, n)
        const fetchers: Record<string, Promise<unknown>> = {}
        for (const t of batch) {
          const code = t.uniqueCode || t.copyTraderId
          if (code) fetchers[code] = publicApi.getLeadTraderStats(code, type, "30")
        }
        const statsRes = await fetchAllSettled(fetchers)
        const ranked = batch.map((t: any) => {
          const code = t.uniqueCode || t.copyTraderId
          const stats = (statsRes.get(code) as any[])?.[0] || {}
          return {
            name: t.nickName || t.name || code, uniqueCode: code,
            pnl: stats.pnl || "N/A", winRate: stats.winRate || "N/A",
            sharpeRatio: stats.sharpeRatio || "N/A", copyCount: stats.copyCount || "0",
            maxDrawdown: stats.maxDrawdown || t.maxDrawdown || "N/A",
          }
        })
        if (sortBy === "pnl") ranked.sort((a, b) => parseFloat(b.pnl === "N/A" ? "0" : b.pnl) - parseFloat(a.pnl === "N/A" ? "0" : a.pnl))
        else if (sortBy === "winRate") ranked.sort((a, b) => parseFloat(b.winRate === "N/A" ? "0" : b.winRate) - parseFloat(a.winRate === "N/A" ? "0" : a.winRate))
        else ranked.sort((a, b) => parseInt(b.copyCount) - parseInt(a.copyCount))
        return toResult({
          tsIso: new Date().toISOString(), instType: type, sortBy, topTraders: ranked,
          _summary: `Top ${ranked.length} 带单员 (按${sortBy === "pnl" ? "收益" : sortBy === "winRate" ? "胜率" : "跟单人数"}排序)。`,
          tip: "确认带单员后，使用 okx_first_copy_settings { uniqueCode } → okx_copy_trader 开始跟单。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 6: agent_option_scanner — 期权市场扫描
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_option_scanner",
    "READ",
    "CAT:[市场扫描] | 期权全景扫描：概要+OI到期/行权价分布+PCR+大宗交易量",
    { uly: z.string().describe("标的，如 BTC-USD、ETH-USD。必填") },
    async ({ uly }) => {
      try {
        const { get, errors } = await fetchAllSettled({
          summary: publicApi.getOptSummary(uly),
          oiExpiry: publicApi.getOptionOiExpiry(uly),
          pcr: publicApi.getOptionPutCallRatio(uly),
          blockVol: publicApi.getOptionTakerBlockVolume(uly),
        })
        const summary = (get("summary") as any[]) || []
        const oiExpiry = (get("oiExpiry") as any[]) || []
        const pcrData = ((get("pcr") as any[])?.[0] || {}) as any
        const blockData = ((get("blockVol") as any[])?.[0] || {}) as any
        return toResult({
          tsIso: new Date().toISOString(), underlying: uly,
          summary: summary.slice(0, 20).map((s: any) => ({
            instId: s.instId, expTime: s.expTime, strike: s.strike, optionType: s.optType,
            markPx: s.markPx, delta: s.delta, oi: s.oi, vol24h: s.vol24h,
          })),
          oiByExpiry: oiExpiry.map((e: any) => ({ expTime: e.expTime, callOi: e.callOi, putOi: e.putOi })),
          putCallRatio: { oiRatio: pcrData.oiRatio || "N/A", volRatio: pcrData.volRatio || "N/A" },
          blockTrades: blockData.callVol !== undefined ? { callVol: blockData.callVol, putVol: blockData.putVol } : null,
          errors,
          _summary: `${uly} 期权扫描：${summary.length} 个合约，PCR(持仓) ${pcrData.oiRatio || "N/A"}。`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 7: agent_prediction_arbitrage — 预测市场套利
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_prediction_arbitrage",
    "READ",
    "CAT:[预测市场] | 扫描预测市场事件，发现 YES+NO 价差 < 1.0 的无风险套利机会",
    {},
    async () => {
      try {
        const events = (await publicApi.searchPredictionsEvents("")) as any[]
        const evtList = Array.isArray(events) ? events.slice(0, 10) : []
        const fetchers: Record<string, Promise<unknown>> = {}
        for (const evt of evtList) {
          const id = evt.eventId || evt.event_id
          if (id) fetchers[`evt_${id}`] = publicApi.getPredictionsEvent(id)
          const mktId = evt.marketId || evt.market_id
          if (mktId) fetchers[`mkt_${mktId}`] = publicApi.getPredictionsMarket(mktId)
        }
        const { get } = await fetchAllSettled(fetchers)
        const opportunities: any[] = []
        for (const evt of evtList) {
          const id = evt.eventId || evt.event_id; const mktId = evt.marketId || evt.market_id
          const mktData = get(`mkt_${mktId}`) as any
          const yesPrice = parseFloat(mktData?.yesPrice || evt.yesPrice || "0")
          const noPrice = parseFloat(mktData?.noPrice || evt.noPrice || "0")
          const total = yesPrice + noPrice
          if (total > 0 && total < 0.99) {
            opportunities.push({
              eventId: id, title: evt.title || "?",
              yesPrice: yesPrice.toFixed(4), noPrice: noPrice.toFixed(4),
              total: total.toFixed(4), discount: ((1 - total) * 100).toFixed(2) + "%",
            })
          }
        }
        return toResult({
          tsIso: new Date().toISOString(), eventsScanned: evtList.length, opportunities,
          _summary: opportunities.length > 0
            ? `发现 ${opportunities.length} 个套利机会：${opportunities.slice(0, 3).map((o: any) => `${o.title}(${o.discount})`).join(", ")}`
            : `已扫描 ${evtList.length} 个事件，当前无 YES+NO<1.0 的套利机会。`,
          tip: "确认机会后用 okx_predictions_place_order 或 okx_event_place_order 分别买入 YES 和 NO。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // Skill 8: agent_technical_report — 多周期技术分析报告
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_technical_report",
    "READ",
    "CAT:[技术指标] | 多周期(1H/4H/1D)技术指标综合计算，输出方向共识信号",
    {
      instId: z.string().describe("交易品种，如 BTC-USDT。必填"),
      bars: z.array(z.enum(["1H","4H","1D","1W"])).optional().default(["1H","4H","1D"]).describe("K线周期"),
    },
    async ({ instId, bars }) => {
      try {
        const periods = bars || ["1H", "4H", "1D"]
        const fetchers: Record<string, Promise<unknown>> = { ticker: publicApi.getTicker(instId) }
        for (const bar of periods) fetchers[`c_${bar}`] = publicApi.getCandles(instId, bar, 100)
        const { get, errors } = await fetchAllSettled(fetchers)
        const tickerData = ((get("ticker") as any[])?.[0] || {}) as any
        const lastPrice = parseFloat(tickerData.last || "0")

        const periodResults: any[] = []
        for (const bar of periods) {
          const candles = (get(`c_${bar}`) as any[][]) || []
          if (candles.length < 20) { periodResults.push({ period: bar, status: "数据不足" }); continue }
          const closes = candles.map((c: any[]) => parseFloat(c[4] || "0"))
          const sma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
          const ema = (data: number[], period: number) => { const k = 2 / (period + 1); let e = data[0]; for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k); return e }
          const macd = ema(closes, 12) - ema(closes, 26)
          const rsiData = closes.slice(-15); let gain = 0, loss = 0
          for (let i = 1; i < rsiData.length; i++) { const d = rsiData[i] - rsiData[i - 1]; if (d > 0) gain += d; else loss -= d }
          const rsi = loss === 0 ? 100 : 100 - 100 / (1 + (gain / 14) / (loss / 14))
          const signals: string[] = []
          if (lastPrice > sma20) signals.push("价格>SMA20(偏多)"); else signals.push("价格<SMA20(偏空)")
          if (macd > 0) signals.push("MACD>0(偏多)"); else signals.push("MACD<0(偏空)")
          if (rsi > 70) signals.push("RSI超买(偏空)"); else if (rsi < 30) signals.push("RSI超卖(偏多)")
          const bull = signals.filter(s => s.includes("偏多")).length
          const bear = signals.filter(s => s.includes("偏空")).length
          periodResults.push({ period: bar, lastPrice, sma20: sma20.toFixed(2), macd: macd.toFixed(6), rsi: rsi.toFixed(1), signals, direction: bull > bear ? "🟢 偏多" : bear > bull ? "🔴 偏空" : "🟡 中性" })
        }
        const bullPeriods = periodResults.filter(p => p.direction?.includes("偏多")).map(p => p.period)
        const bearPeriods = periodResults.filter(p => p.direction?.includes("偏空")).map(p => p.period)
        const consensus = bullPeriods.length > bearPeriods.length ? `多数周期偏多(${bullPeriods.join(",")})` : bearPeriods.length > bullPeriods.length ? `多数周期偏空(${bearPeriods.join(",")})` : "多空分歧"
        return toResult({
          tsIso: new Date().toISOString(), instId, currentPrice: lastPrice, consensus, periods: periodResults, errors,
          _summary: `${instId} 多周期TA：${consensus}。当前价 $${lastPrice}。`,
          disclaimer: "以上为L1基础指标计算，不构成投资建议。详细多指标分析可使用 okx_indicator_batch。",
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_get_preference — 获取 Agent 偏好 (restored)
  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_get_preference",
    "READ",
    "CAT:[系统] | 读取 Agent 持久化偏好，跨会话保留",
    {
      key: z.string().optional().describe("偏好键名，不填返回全部"),
    },
    async ({ key }) => {
      try {
        const prefPath = path.join(os.homedir(), ".hvip", "preferences.json")
        let prefs: Record<string, string> = {}
        try {
          if (fs.existsSync(prefPath)) { prefs = JSON.parse(fs.readFileSync(prefPath, "utf-8")) }
        } catch (e: unknown) {
          // 备份损坏文件，防止偏好静默丢失
          const corrupted = prefPath + ".corrupted." + new Date().toISOString().replace(/[:.]/g, "-")
          try { fs.renameSync(prefPath, corrupted) } catch {}
          process.stderr.write(`[hvip] ⚠️ preferences.json 损坏，已备份为 ${corrupted}，重置为空\n`)
        }
        const result = key
          ? { key, value: prefs[key] ?? null, found: key in prefs }
          : { all: prefs, count: Object.keys(prefs).length }
        return toResult({
          ...result,
          tsIso: new Date().toISOString(),
          _summary: key
            ? `偏好 "${key}" = ${prefs[key] ? `"${prefs[key]}"` : "未设置"}`
            : `已存储 ${Object.keys(prefs).length} 条偏好`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  registerTool(
    server,
    "agent_set_preference",
    "READ",
    "CAT:[系统] | ## 功能：设置 Agent 持久化偏好，跨会话保留\n## 场景：用户说\"以后默认交易对用BTC-USDT\"时，Agent 保存偏好，下次会话自动恢复\n## 关键词：偏好, preference, 设置, 记忆, 持久化, 用户画像\n## 参数：\n##   - key: 偏好键名\n##   - value: 偏好值\n## 鉴权：PUBLIC — 本地写入\n## 风险：READ — 本地文件写入，无资金风险\n## 返回量：微小 ~200B\n## 关联：本工具设置偏好 → agent_get_preference 读取 → Agent 按偏好决策\n## 常用键名参考:\n##   - default_instId: 默认交易对，如 BTC-USDT-SWAP\n##   - default_tdMode: 默认交易模式 (cross/isolated/cash)\n##   - risk_level: 风险偏好 (low/medium/high)\n##   - trade_mode: 交易模式 (spot_only/swap_permitted/margin_permitted)\n##   - position_size_pct: 单笔仓位占比，如 0.1 (10%)",
    {
      key:   z.string().describe("偏好键名。常用: default_instId, default_tdMode, risk_level, trade_mode, position_size_pct"),
      value: z.string().describe("偏好值"),
    },
    async ({ key, value }) => {
      try {
        const dir = path.join(os.homedir(), ".hvip")
        const prefPath = path.join(dir, "preferences.json")
        let prefs: Record<string, string> = {}
        try {
          fs.mkdirSync(dir, { recursive: true })
          if (fs.existsSync(prefPath)) {
            prefs = JSON.parse(fs.readFileSync(prefPath, "utf-8"))
          }
        } catch (e: unknown) {
          const corrupted = prefPath + ".corrupted." + new Date().toISOString().replace(/[:.]/g, "-")
          try { fs.renameSync(prefPath, corrupted) } catch {}
          process.stderr.write(`[hvip] ⚠️ preferences.json 损坏，已备份为 ${corrupted}，重置为空\n`)
        }
        prefs[key] = value
        fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2), "utf-8")

        return toResult({
          ok: true,
          key, value,
          stored: Object.keys(prefs).length,
          tsIso: new Date().toISOString(),
          _summary: `已保存偏好: "${key}" = "${value}"（共 ${Object.keys(prefs).length} 条偏好）`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_catalog — 全局工具导航（Agent 首次连接入口）
  // ══════════════════════════════════════════════════════════════════════

  // 目录数据：按「用户想做什么」分组，不按 API 模块分组
  	  const CATALOG = CATALOG_DATA

  registerTool(
    server,
    "agent_catalog",
    "READ",
    "CAT:[系统] | ## 功能：全局工具导航——Agent 首次连接 hvip MCP 后第一个应调用的工具。返回按用户意图分组的工具地图\n## 场景：Agent 首次连接、不确定该用什么工具、想了解 hvip 能做什么。看完目录后 Agent 按域直达目标工具，无需阅读全部 350+ 工具描述\n## 关键词：导航, catalog, 目录, 地图, 入口, 首次连接, 工具发现, 索引, 路由\n## 参数：无\n## 鉴权：PUBLIC — 纯索引，不查任何 API\n## 风险：READ — 只读\n## 返回量：微小 ~5KB — 12 个域的结构化索引\n## 关联：本工具看全局 → agent_catalog_detail { domain } 看域详情 → 直接调用目标工具",
    {},
    async () => {
      try {
        // ── 动态状态感知 ──
        const hasAuth = auth !== null
        const setup: any = {
          hasApiKey: hasAuth,
          readOnly: process.env.OKX_READ_ONLY === "true",
          mode: hasAuth
            ? (process.env.OKX_READ_ONLY === "true" ? "只读（WRITE 工具已隐藏）" : "完整交易（所有工具可用）")
            : "未配置 API Key（仅公开工具可用）",
        }

        if (!hasAuth) {
          setup.howToConfigure = {
            required: ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"],
            where: "OKX 官网 -> 个人中心 -> API -> 创建 API Key（开通 读取+交易 权限）",
            quickStart: "npx hvip-mcp setup --client claude-code",
          }
          setup.whatYouCanDoNow = "当前无 API Key，但以下域的工具可立即使用: 行情看盘 / 技术指标 / 市场扫描 / 聪明钱 / 预测市场（公开查询）/ WebSocket 实时 / 系统工具"
        }

        const onboarding = hasAuth
          ? "API Key 已配置。建议第一步: agent_get_preference 恢复偏好 -> okx_account_overview 了解账户全景 -> 根据用户意图匹配域 go_to 工具"
          : "欢迎！hvip MCP 已连接但尚未配置 API Key。告诉用户：想看行情和指标现在就能看，想看账户和交易请先配 Key。配好后重连 MCP 即可。"

        const publicDomains = CATALOG.domains.filter((d: any) => !d.authRequired)
        const authDomains   = CATALOG.domains.filter((d: any) => d.authRequired)

        return toResult({
          tsIso: new Date().toISOString(),
          _setup: setup,
          _onboarding: onboarding,
          _instruction: CATALOG._instruction,
          publicDomains,
          authDomains: hasAuth ? authDomains : authDomains.map((d: any) => ({ ...d, _disabled: "需要 API Key 才能使用此域" })),
          _tips: CATALOG._tips,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_catalog_detail — 单域工具详情
  // ══════════════════════════════════════════════════════════════════════

  // 每个域的详细工具清单（含参数提示、鉴权、调用顺序）
  const DOMAIN_DETAILS: Record<string, any> = DOMAIN_DATA

  registerTool(
    server,
    "agent_catalog_detail",
    "READ",
    "CAT:[系统] | ## 功能：查看某个业务域的详细工具清单——含每个工具的参数提示、鉴权要求、推荐调用顺序\n## 场景：Agent 在 agent_catalog 确定域后，调用此工具获取该域所有工具的精准信息、参数提示和典型 workflow\n## 关键词：目录详情, catalog detail, 工具清单, 域详情, workflow\n## 参数：\n##   - domain: 域名称。可取值: 账户资产 | 行情看盘 | 下单交易 | 风险风控 | 市场扫描 | 盈亏复盘 | 资金管理 | 策略交易 | 预测市场 | WebSocket 实时 | 模拟估算 | 系统工具\n## 鉴权：PUBLIC — 纯索引\n## 风险：READ — 只读\n## 返回量：微小 ~2KB — 单域详情\n## 关联：agent_catalog 选域 → 本工具获取详情 → 直接调用目标工具",
    {
      domain: z.string().describe("域名称。可选: 账户资产, 行情看盘, 技术指标, 下单交易, 风险风控, 市场扫描, 聪明钱, 盈亏复盘, 资金管理, 策略交易, 预测市场, 代码智能, WebSocket 实时, 模拟估算, 系统工具"),
    },
    async ({ domain }) => {
      try {
        const detail = DOMAIN_DETAILS[domain]
        const hasAuth = auth !== null
        if (!detail) {
          return toResult({
            found: false,
            domain,
            availableDomains: Object.keys(DOMAIN_DETAILS),
            hint: "请从 availableDomains 中选择一个域，或调 agent_catalog 查看完整导航",
            tsIso: new Date().toISOString(),
          })
        }
        const needsKey = detail.authRequired && !hasAuth
        return toResult({
          found: true,
          domain,
          authRequired: detail.authRequired,
          keyAvailable: hasAuth,
          usable: !detail.authRequired || hasAuth,
          _authWarning: needsKey ? "⚠️ 此域需要 API Key，当前未配置。告诉用户去 OKX 官网创建 Key 后重连。" : null,
          ...detail,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )
}
