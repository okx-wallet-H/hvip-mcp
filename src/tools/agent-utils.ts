import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

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
  server.tool(
    "okx_account_overview",
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
  server.tool(
    "okx_quick_market",
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
  server.tool(
    "okx_preflight_check",
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
  server.tool(
    "okx_agent_feedback",
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
        const logDir = process.env.OKX_FEEDBACK_DIR || os.homedir()
        const logFile = path.join(logDir, "hvip-mcp-feedback.log")
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
  server.tool(
    "agent_risk_overview",
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
  server.tool(
    "agent_quick_trade",
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
  server.tool(
    "agent_market_scan",
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
  server.tool(
    "agent_pnl_report",
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
  server.tool(
    "agent_simulate_order",
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
  // agent_get_preference — 获取 Agent 偏好
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "agent_get_preference",
    "CAT:[系统] | ## 功能：读取 Agent 持久化偏好，跨会话保留\n## 场景：Agent 在新会话中恢复用户偏好（如\"只做现货\"\"默认交易对BTC-USDT\"\"风险偏好低\"）\n## 关键词：偏好, preference, 记忆, 持久化, 用户画像\n## 参数：\n##   - key: 偏好键名。不填返回全部偏好\n## 鉴权：PUBLIC — 本地读取\n## 风险：READ — 只读\n## 返回量：微小 ~300B\n## 关联：agent_set_preference 设置偏好 → 本工具 → Agent 根据偏好调整策略",
    {
      key: z.string().optional().describe("偏好键名，不填返回全部"),
    },
    async ({ key }) => {
      try {
        const prefPath = path.join(os.homedir(), ".hvip", "preferences.json")
        let prefs: Record<string, string> = {}
        try {
          if (fs.existsSync(prefPath)) {
            prefs = JSON.parse(fs.readFileSync(prefPath, "utf-8"))
          }
        } catch {}

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
  // agent_set_preference — 设置 Agent 偏好
  // ══════════════════════════════════════════════════════════════════════
  server.tool(
    "agent_set_preference",
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
        } catch {}
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
  const CATALOG = {
    _instruction: [
      "你是 hvip MCP Server 的 Agent。本目录帮你按用户意图快速定位工具，无需扫描全部 350+ 个工具描述。",
      "用法: 1) 根据用户说的话匹配下方某个域的 when 触发词 → 2) 调用该域的 go_to 工具 → 3) 如需深入再调用 also 列表中的工具。",
      "不确定域时调用 agent_catalog_detail { domain } 查看该域的详细工具清单。",
      "注意: 所有 WRITE/ADMIN 级别的工具需用户确认后才能调用。",
    ].join(" "),

    domains: [
      {
        domain: "账户资产",
        what: "查看账户余额、持仓、配置、手续费、估值",
        when: ["我的账户", "持仓", "余额", "保证金", "杠杆倍数", "资产估值", "手续费率", "账户配置"],
        go_to: "okx_account_overview",
        also: [
          "okx_get_balance — 各币种余额明细",
          "okx_get_positions — 持仓详情（含平仓上下文 _actionContext）",
          "okx_get_account_config — 账户模式/持仓模式",
          "okx_get_asset_valuation — 总资产估值",
          "okx_get_fee_rates — 手续费率",
          "okx_get_leverage_info — 当前杠杆倍数",
          "okx_get_max_size — 最大可开数量",
          "okx_set_leverage — 调整杠杆（WRITE，需确认）",
        ],
        risk: "READ",
      },
      {
        domain: "行情看盘",
        what: "查看产品价格、K线、深度、成交记录",
        when: ["BTC价格", "ETH行情", "K线", "涨跌", "深度", "盘口", "成交记录", "走势"],
        go_to: "okx_quick_market",
        also: [
          "okx_get_ticker — 单个产品实时行情",
          "okx_get_tickers — 某类型全部产品行情",
          "okx_get_orderbook — 完整深度/盘口",
          "okx_get_candles — K线数据",
          "okx_get_trades — 最新成交记录",
          "okx_get_history_candles — 历史K线",
          "okx_get_index_candles — 指数K线",
          "okx_get_mark_price_candles — 标记价K线",
        ],
        risk: "READ",
      },
      {
        domain: "下单交易",
        what: "下单、撤单、改单、平仓",
        when: ["买入", "卖出", "下单", "开仓", "平仓", "撤单", "改单", "挂单"],
        go_to: "agent_quick_trade",
        also: [
          "okx_preflight_check — 下单前预检（数量/限价/合约换算）",
          "agent_simulate_order — 模拟下单（不产生真实订单）",
          "okx_place_order — 标准下单（WRITE，需确认）",
          "okx_cancel_order — 撤单（WRITE）",
          "okx_amend_order — 改单（WRITE）",
          "okx_close_position — 平仓（WRITE，需确认）",
          "okx_get_order — 查询订单状态",
          "okx_get_orders_pending — 当前挂单",
          "okx_get_orders_history — 历史订单",
          "okx_batch_orders — 批量下单（WRITE）",
          "okx_batch_cancel_orders — 批量撤单（WRITE）",
          "okx_amend_batch_orders — 批量改单（WRITE）",
        ],
        risk: "WRITE",
      },
      {
        domain: "风险风控",
        what: "持仓风险评估、强平预警、保证金率",
        when: ["风险", "爆仓", "强平", "保证金率", "健康度", "风控", "会不会爆"],
        go_to: "agent_risk_overview",
        also: [
          "okx_get_account_position_risk — 账户持仓风险详情",
          "okx_get_risk_state — 账户风控状态",
          "okx_get_positions — 持仓中的 mgnRatio/liqPx",
          "okx_get_margin_balance — 保证金余额",
          "agent_quick_trade — 风控告警后平仓（WRITE）",
        ],
        risk: "READ",
      },
      {
        domain: "市场扫描",
        what: "发现市场机会、涨幅榜、跌幅榜、资金费率异常",
        when: ["今天有什么机会", "涨幅榜", "跌幅榜", "什么在涨", "什么在跌", "异动", "扫描"],
        go_to: "agent_market_scan",
        also: [
          "okx_quick_market — 深入看某个品种",
          "okx_get_funding_rate — 永续合约资金费率",
          "okx_get_tickers — 全市场行情",
        ],
        risk: "READ",
      },
      {
        domain: "盈亏复盘",
        what: "计算已实现/未实现盈亏、交易绩效",
        when: ["赚了多少", "亏了多少", "盈亏", "绩效", "复盘", "PnL", "收益"],
        go_to: "agent_pnl_report",
        also: [
          "okx_get_positions — 当前浮动盈亏",
          "okx_get_orders_history — 历史订单盈亏",
          "okx_get_positions_history — 历史平仓盈亏",
          "okx_get_fills — 成交明细",
        ],
        risk: "READ",
      },
      {
        domain: "资金管理",
        what: "划转、提现、充值、兑换",
        when: ["划转", "提现", "充值", "转账", "兑换", "闪兑", "出入金", "deposit", "withdraw"],
        go_to: "okx_get_balance",
        also: [
          "okx_transfer — 资金划转（WRITE，需确认）",
          "okx_withdrawal — 提现（WRITE，需确认）",
          "okx_get_deposit_address — 获取充值地址",
          "okx_get_deposit_history — 充值记录",
          "okx_get_withdrawal_history — 提现记录",
          "okx_convert_trade — 一键兑换（WRITE，需确认）",
          "okx_get_convert_currencies — 可兑换币种",
          "okx_get_currencies — 链上币种信息",
          "okx_get_funding_balance — 资金账户余额",
        ],
        risk: "FUND_TRANSFER",
      },
      {
        domain: "策略交易",
        what: "网格、跟单、信号、策略委托、价差、RFQ",
        when: ["网格", "跟单", "信号", "策略", "定投", "价差", "大宗", "RFQ"],
        go_to: "okx_get_grid_ai_param",
        also: [
          "okx_create_grid_order — 创建网格（WRITE，需确认）",
          "okx_stop_grid_order — 停止网格",
          "okx_get_grid_positions — 网格持仓",
          "okx_create_recurring_plan — 创建定投计划（WRITE）",
          "okx_copy_trader — 开始跟单（WRITE，需确认）",
          "okx_get_lead_trader_positions — 交易员持仓",
          "okx_get_lead_trader_stats — 交易员统计",
          "okx_place_algo_order — 策略委托下单（WRITE）",
          "okx_get_algo_orders — 策略委托列表",
          "okx_create_rfq — 创建大宗询价（WRITE）",
        ],
        risk: "WRITE",
      },
      {
        domain: "预测市场",
        what: "事件合约、预测市场交易",
        when: ["预测市场", "事件合约", "outcomes", "predictions", "对赌"],
        go_to: "okx_event_instruments",
        also: [
          "okx_event_place_order — 事件合约下单（WRITE）",
          "okx_event_fills — 事件合约成交",
          "okx_predictions_positions — 预测市场持仓",
          "okx_predictions_order_list — 预测市场订单",
          "okx_predictions_redeem — 预测市场赎回（WRITE）",
        ],
        risk: "READ",
      },
      {
        domain: "技术指标",
        what: "技术分析指标计算：RSI、MACD、布林带、ADX、Supertrend 等 17 种指标",
        when: ["RSI", "MACD", "布林带", "KDJ", "ADX", "超买", "超卖", "金叉", "死叉", "技术指标", "指标分析"],
        go_to: "okx_indicator",
        also: [
          "okx_indicator — 单指标计算+信号解读",
          "okx_indicator_batch — 多指标批量+综合信号",
          "okx_get_candles — 原始K线数据",
        ],
        risk: "READ",
      },
      {
        domain: "聪明钱",
        what: "交易员排行榜、聪明钱流向、市场情绪分析",
        when: ["交易员", "排行榜", "聪明钱", "跟谁赚钱", "情绪", "多空比", "恐慌", "smart money"],
        go_to: "okx_smart_leaderboard",
        also: [
          "okx_smart_leaderboard — 交易员排行榜",
          "okx_smart_trader_detail — 单交易员深度分析",
          "okx_smart_sentiment — 市场情绪仪表盘",
          "okx_get_lead_trader_positions — 交易员当前持仓",
          "okx_get_lead_trader_stats — 交易员历史统计",
        ],
        risk: "READ",
      },
      {
        domain: "WebSocket 实时",
        what: "实时行情推送、成交推送",
        when: ["实时", "订阅", "推送", "websocket", "ws", "监听"],
        go_to: "okx_ws_subscribe",
        also: [
          "okx_ws_events — 获取推送事件",
          "okx_ws_status — 订阅状态",
          "okx_ws_close — 关闭订阅",
        ],
        risk: "READ",
      },
      {
        domain: "模拟估算",
        what: "不产生真实订单，预估成交价、滑点、手续费",
        when: ["如果买入", "如果卖出", "模拟", "预估", "沙盒", "试算", "会怎样"],
        go_to: "agent_simulate_order",
        also: [
          "agent_quick_trade — 确认后真实下单（WRITE）",
          "okx_preflight_check — 下单前参数校验",
          "okx_position_builder — 组合保证金试算",
        ],
        risk: "READ",
      },
      {
        domain: "系统工具",
        what: "偏好设置、反馈留言、Agent集群管理",
        when: ["偏好", "设置默认", "记住", "反馈", "建议", "Agent Hub", "集群"],
        go_to: "agent_get_preference",
        also: [
          "agent_set_preference — 保存偏好",
          "okx_agent_feedback — 提交使用反馈",
          "agent_hub_status — Agent 集群状态",
          "agent_hub_dispatch — 派发任务",
          "agent_room_send — 房间消息",
          "xlayer_subscribe — X Layer 链上事件",
          "xlayer_call — X Layer 合约调用（WRITE）",
        ],
        risk: "READ",
      },
    ],

    _tips: [
      "Agent 最佳实践：每个新会话先调 agent_get_preference 恢复用户偏好",
      "需要 API Key 的工具（账户/交易类）需用户先配置 OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE 环境变量",
      "WRITE 级别工具会修改用户账户，调用前 Agent 必须向用户确认",
      "深度调研某个域时调 agent_catalog_detail { domain } 获取该域全部工具详情",
      "技术指标用 okx_indicator 单个计算或 okx_indicator_batch 批量，支持 RSI/MACD/布林带等 17 种",
      "聪明钱分析用 okx_smart_leaderboard 找顶尖交易员 → okx_smart_sentiment 看市场情绪",
    ],
  }

  server.tool(
    "agent_catalog",
    "CAT:[系统] | ## 功能：全局工具导航——Agent 首次连接 hvip MCP 后第一个应调用的工具。返回按用户意图分组的工具地图\n## 场景：Agent 首次连接、不确定该用什么工具、想了解 hvip 能做什么。看完目录后 Agent 按域直达目标工具，无需阅读全部 350+ 工具描述\n## 关键词：导航, catalog, 目录, 地图, 入口, 首次连接, 工具发现, 索引, 路由\n## 参数：无\n## 鉴权：PUBLIC — 纯索引，不查任何 API\n## 风险：READ — 只读\n## 返回量：微小 ~5KB — 12 个域的结构化索引\n## 关联：本工具看全局 → agent_catalog_detail { domain } 看域详情 → 直接调用目标工具",
    {},
    async () => {
      try {
        return toResult({
          tsIso: new Date().toISOString(),
          ...CATALOG,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ══════════════════════════════════════════════════════════════════════
  // agent_catalog_detail — 单域工具详情
  // ══════════════════════════════════════════════════════════════════════

  // 每个域的详细工具清单（含参数提示、鉴权、调用顺序）
  const DOMAIN_DETAILS: Record<string, any> = {
    "账户资产": {
      workflow: "okx_account_overview（全景）→ 查看具体项 → okx_get_balance / okx_get_positions 细化",
      tools: [
        { name: "okx_account_overview", auth: "API Key", params: "无", what: "账户全景：余额+持仓+配置+估值 四合一一键查询" },
        { name: "okx_get_balance", auth: "API Key", params: "ccy? (币种，不填全部)", what: "交易账户各币种余额" },
        { name: "okx_get_positions", auth: "API Key", params: "instType? (不填全部)", what: "持仓详情，含 _actionContext 可直接用于平仓" },
        { name: "okx_get_account_config", auth: "API Key", params: "无", what: "账户模式/持仓模式/UID" },
        { name: "okx_get_asset_valuation", auth: "API Key", params: "ccy? (计价币种)", what: "总资产估值" },
        { name: "okx_get_fee_rates", auth: "API Key", params: "instType?, instId?", what: "手续费率" },
        { name: "okx_get_leverage_info", auth: "API Key", params: "instId, mgnMode", what: "当前杠杆倍数" },
        { name: "okx_get_max_size", auth: "API Key", params: "instId, tdMode", what: "最大可开仓数量" },
        { name: "okx_set_leverage", auth: "API Key (交易)", params: "instId, lever, mgnMode", what: "调整杠杆 — WRITE，需确认" },
        { name: "okx_get_max_loan", auth: "API Key", params: "instId, mgnMode", what: "最大可借数量" },
        { name: "okx_get_margin_balance", auth: "API Key", params: "instId, mgnMode", what: "保证金余额详情" },
        { name: "okx_set_position_mode", auth: "API Key (交易)", params: "posMode", what: "切换持仓模式 — ADMIN，需确认" },
        { name: "okx_get_account_bills", auth: "API Key", params: "instType?, ccy?, limit?", what: "账户资金流水" },
        { name: "okx_get_interest_accrued", auth: "API Key", params: "instId?, ccy?", what: "借币利息累计" },
        { name: "okx_get_interest_rates", auth: "API Key", params: "ccy?", what: "各币种借币利率" },
        { name: "okx_get_interest_limits", auth: "API Key", params: "无", what: "利息限额" },
        { name: "okx_get_max_withdrawal", auth: "API Key", params: "ccy?", what: "最大可提现数量" },
        { name: "okx_get_account_position_risk", auth: "API Key", params: "无", what: "持仓风险评估" },
        { name: "okx_get_risk_state", auth: "API Key", params: "无", what: "账户风控状态" },
        { name: "okx_get_account_greeks", auth: "API Key", params: "instType?, instFamily?", what: "期权 Greeks 风险参数" },
        { name: "okx_get_trade_fee", auth: "API Key", params: "instType?, instId?", what: "按产品维度查询手续费" },
        { name: "okx_get_convert_currencies", auth: "API Key", params: "无", what: "支持一键兑换的币种列表" },
        { name: "okx_convert_trade", auth: "API Key (交易)", params: "fromCcy, toCcy, sz", what: "执行资产兑换 — FUND_TRANSFER，需确认" },
        { name: "okx_get_bills", auth: "API Key", params: "instType?, ccy?", what: "账户账单流水" },
        { name: "okx_get_positions_history", auth: "API Key", params: "instType?, instId?", what: "历史持仓（已平仓）" },
        { name: "okx_get_account_bills_archive", auth: "API Key", params: "无", what: "归档账单（3个月前）" },
        { name: "okx_borrow_repay", auth: "API Key (交易)", params: "ccy, side(borrow|repay), amt", what: "借币/还款 — FUND_TRANSFER，需确认" },
        { name: "okx_get_borrow_repay_history", auth: "API Key", params: "无", what: "借贷历史记录" },
        { name: "okx_activate_option", auth: "API Key (交易)", params: "无", what: "激活期权交易 — ADMIN，需确认" },
        { name: "okx_set_account_mode", auth: "API Key (交易)", params: "acctLv(1|2|3|4)", what: "设置账户层级 — ADMIN，需确认" },
      ],
    },
    "行情看盘": {
      workflow: "okx_quick_market（速览）→ 需要K线时调 okx_get_candles → 需要全深度时调 okx_get_orderbook",
      tools: [
        { name: "okx_quick_market", auth: "公开", params: "instId", what: "行情+5档深度+资金费率 三合一速览" },
        { name: "okx_get_ticker", auth: "公开", params: "instId", what: "单个产品最新行情" },
        { name: "okx_get_tickers", auth: "公开", params: "instType", what: "某类型全部产品行情" },
        { name: "okx_get_orderbook", auth: "公开", params: "instId, sz?", what: "订单簿深度（默认1档，最大400档）" },
        { name: "okx_get_books_full", auth: "公开", params: "instId", what: "全量订单簿" },
        { name: "okx_get_candles", auth: "公开", params: "instId, bar, limit?", what: "K线数据" },
        { name: "okx_get_history_candles", auth: "公开", params: "instId, bar, after?", what: "历史K线（更早的）" },
        { name: "okx_get_index_candles", auth: "公开", params: "instId, bar", what: "指数K线" },
        { name: "okx_get_mark_price_candles", auth: "公开", params: "instId, bar", what: "标记价K线" },
        { name: "okx_get_trades", auth: "公开", params: "instId, limit?", what: "最新成交记录" },
        { name: "okx_get_history_trades", auth: "公开", params: "instId, after?", what: "历史成交记录" },
        { name: "okx_get_index_tickers", auth: "公开", params: "quoteCcy?", what: "指数行情" },
        { name: "okx_get_block_tickers", auth: "公开", params: "instType", what: "批量产品行情（Tickers）" },
        { name: "okx_get_mark_price", auth: "公开", params: "instType?, instId?", what: "标记价格" },
        { name: "okx_get_funding_rate", auth: "公开", params: "instId", what: "永续合约当前资金费率" },
        { name: "okx_get_funding_rate_history", auth: "公开", params: "instId, before?, after?", what: "资金费率历史" },
      ],
    },
    "下单交易": {
      workflow: "先调 agent_simulate_order 预估 → 再调 okx_preflight_check 校验 → 最后 agent_quick_trade 下单",
      tools: [
        { name: "agent_quick_trade", auth: "API Key (交易)", params: "instId, side, sz, tdMode, px?, ordType?", what: "一键下单全流程 — WRITE，需确认" },
        { name: "agent_simulate_order", auth: "API Key (只读)", params: "instId, side, sz, tdMode, px?", what: "模拟下单：滑点/手续费/成本预估（无真实订单）" },
        { name: "okx_preflight_check", auth: "API Key (只读)", params: "instId, tdMode, sz, px?, side?, ordType?", what: "下单前预检：数量/限价/合约换算" },
        { name: "okx_place_order", auth: "API Key (交易)", params: "instId, tdMode, side, sz, ordType, px?", what: "标准下单 — WRITE，需确认" },
        { name: "okx_batch_orders", auth: "API Key (交易)", params: "orders[]", what: "批量下单 — WRITE" },
        { name: "okx_cancel_order", auth: "API Key (交易)", params: "instId, ordId", what: "撤销单笔订单 — WRITE" },
        { name: "okx_batch_cancel_orders", auth: "API Key (交易)", params: "orders[]", what: "批量撤单 — WRITE" },
        { name: "okx_amend_order", auth: "API Key (交易)", params: "instId, ordId, newSz?, newPx?", what: "修改未成交订单 — WRITE" },
        { name: "okx_amend_batch_orders", auth: "API Key (交易)", params: "orders[]", what: "批量改单 — WRITE" },
        { name: "okx_close_position", auth: "API Key (交易)", params: "instId, posSide, mgnMode", what: "平仓（用 _actionContext 中参数）— WRITE，需确认" },
        { name: "okx_get_order", auth: "API Key", params: "instId, ordId", what: "查询单笔订单状态" },
        { name: "okx_get_orders_pending", auth: "API Key", params: "instType?, instId?", what: "当前挂单列表" },
        { name: "okx_get_orders_history", auth: "API Key", params: "instType, limit?", what: "历史订单（近3个月）" },
        { name: "okx_get_fills", auth: "API Key", params: "instType?, instId?, ordId?", what: "最近成交明细" },
        { name: "okx_get_fills_history", auth: "API Key", params: "instType?, instId?, limit?", what: "历史成交明细" },
      ],
    },
    "风险风控": {
      workflow: "agent_risk_overview（全景）→ 发现风险仓位 → agent_quick_trade 平仓",
      tools: [
        { name: "agent_risk_overview", auth: "API Key", params: "无", what: "全仓风险仪表盘：风险排序+强平预警+保证金率" },
        { name: "okx_get_account_position_risk", auth: "API Key", params: "无", what: "账户持仓风险详情" },
        { name: "okx_get_risk_state", auth: "API Key", params: "无", what: "账户风控状态" },
        { name: "okx_get_margin_balance", auth: "API Key", params: "instId, mgnMode", what: "某产品的保证金余额" },
        { name: "okx_get_positions", auth: "API Key", params: "instType?", what: "持仓中的 liqPx/mgnRatio 字段可直接评估风险" },
        { name: "okx_get_max_withdrawal", auth: "API Key", params: "ccy?", what: "最大可提现额度" },
      ],
    },
    "市场扫描": {
      workflow: "agent_market_scan（异动）→ okx_quick_market（深入）→ 下单",
      tools: [
        { name: "agent_market_scan", auth: "公开", params: "instType?, topN?, sortBy?", what: "涨幅榜/跌幅榜/成交量/资金费率异常一键扫描" },
        { name: "okx_get_tickers", auth: "公开", params: "instType", what: "某类型全部产品行情（可自行排序过滤）" },
        { name: "okx_get_funding_rate", auth: "公开", params: "instId", what: "单产品资金费率" },
        { name: "okx_get_funding_rate_history", auth: "公开", params: "instId", what: "资金费率历史趋势" },
      ],
    },
    "盈亏复盘": {
      workflow: "agent_pnl_report（盈亏报告）→ 需要时查 okx_get_fills 明细",
      tools: [
        { name: "agent_pnl_report", auth: "API Key", params: "days?", what: "浮动盈亏+已实现盈亏 双维日报" },
        { name: "okx_get_positions", auth: "API Key", params: "instType?", what: "当前持仓浮动盈亏" },
        { name: "okx_get_positions_history", auth: "API Key", params: "instType?, instId?", what: "历史平仓盈亏" },
        { name: "okx_get_orders_history", auth: "API Key", params: "instType", what: "历史订单盈亏" },
        { name: "okx_get_fills", auth: "API Key", params: "instType?, instId?", what: "逐笔成交明细（可按 pnl 字段求和）" },
      ],
    },
    "资金管理": {
      workflow: "先看余额 → 再决定划转/提现/充值",
      tools: [
        { name: "okx_get_balance", auth: "API Key", params: "ccy?", what: "交易账户余额" },
        { name: "okx_get_funding_balance", auth: "API Key", params: "ccy?", what: "资金账户余额" },
        { name: "okx_transfer", auth: "API Key (交易)", params: "ccy, amt, from, to", what: "资金划转 — FUND_TRANSFER，需确认" },
        { name: "okx_get_transfer_state", auth: "API Key", params: "transId?", what: "划转状态查询" },
        { name: "okx_withdrawal", auth: "API Key (交易)", params: "ccy, amt, dest, toAddr", what: "提现 — FUND_TRANSFER，需确认" },
        { name: "okx_get_deposit_address", auth: "API Key", params: "ccy", what: "获取充值地址" },
        { name: "okx_get_deposit_history", auth: "API Key", params: "ccy?, limit?", what: "充值记录" },
        { name: "okx_get_withdrawal_history", auth: "API Key", params: "ccy?, limit?", what: "提现记录" },
        { name: "okx_get_currencies", auth: "API Key", params: "ccy?", what: "链上币种信息" },
        { name: "okx_convert_trade", auth: "API Key (交易)", params: "fromCcy, toCcy, sz", what: "一键兑换 — FUND_TRANSFER，需确认" },
        { name: "okx_get_convert_currencies", auth: "API Key", params: "无", what: "可兑换币种列表" },
        { name: "okx_get_max_withdrawal", auth: "API Key", params: "ccy?", what: "最大可提现数量" },
        { name: "okx_get_non_tradable_assets", auth: "API Key", params: "ccy?", what: "不可交易资产" },
        { name: "okx_get_exchange_list", auth: "API Key", params: "无", what: "交易所列表" },
        { name: "okx_get_deposit_withdraw_status", auth: "API Key", params: "无", what: "充提状态" },
      ],
    },
    "策略交易": {
      workflow: "网格/跟单/信号/策略委托 各自独立，按需调用",
      tools: [
        { name: "okx_get_grid_ai_param", auth: "API Key", params: "instType, algoOrdType", what: "网格AI参数推荐" },
        { name: "okx_create_grid_order", auth: "API Key (交易)", params: "instId, algoOrdType, maxPx, minPx, gridNum, sz", what: "创建网格 — WRITE" },
        { name: "okx_stop_grid_order", auth: "API Key (交易)", params: "algoId, instId, algoOrdType, stopType", what: "停止网格" },
        { name: "okx_close_grid_position", auth: "API Key (交易)", params: "algoId, mktClose", what: "平仓网格所有持仓" },
        { name: "okx_get_grid_positions", auth: "API Key (交易)", params: "algoOrdType, algoId?", what: "网格持仓" },
        { name: "okx_get_grid_sub_orders", auth: "API Key", params: "algoId, algoOrdType, type", what: "网格子订单" },
        { name: "okx_get_grid_orders_pending", auth: "API Key", params: "algoOrdType, algoId?", what: "运行中的网格" },
        { name: "okx_get_grid_orders_history", auth: "API Key", params: "algoOrdType, algoId?", what: "历史网格" },
        { name: "okx_create_recurring_plan", auth: "API Key (交易)", params: "instId, sz, period, recurringList", what: "定投计划 — WRITE" },
        { name: "okx_stop_recurring_plan", auth: "API Key (交易)", params: "algoId", what: "停止定投" },
        { name: "okx_copy_trader", auth: "API Key (交易)", params: "uniqueCode, copyTotalAmt, instType", what: "开始跟单 — WRITE，需确认" },
        { name: "okx_get_copy_traders", auth: "API Key", params: "无", what: "我关注的交易员" },
        { name: "okx_get_public_lead_traders", auth: "公开", params: "instType, sortType?", what: "公开交易员列表" },
        { name: "okx_get_lead_trader_positions", auth: "API Key", params: "uniqueCode", what: "交易员当前持仓" },
        { name: "okx_get_lead_trader_stats", auth: "API Key", params: "uniqueCode", what: "交易员业绩统计" },
        { name: "okx_place_algo_order", auth: "API Key (交易)", params: "instId, tdMode, side, ordType, sz, triggerPx", what: "策略委托下单 — WRITE" },
        { name: "okx_get_algo_orders", auth: "API Key", params: "ordType?, algoId?", what: "策略委托列表" },
        { name: "okx_cancel_algo_order", auth: "API Key (交易)", params: "algoId, instId", what: "撤销策略委托 — WRITE" },
      ],
    },
    "预测市场": {
      workflow: "okx_event_instruments 看市场 → okx_event_place_order 下单",
      tools: [
        { name: "okx_event_instruments", auth: "公开", params: "eventType?", what: "事件合约产品列表" },
        { name: "okx_event_place_order", auth: "API Key (交易)", params: "instId, side, sz, ordType?", what: "事件合约下单 — WRITE" },
        { name: "okx_event_cancel_order", auth: "API Key (交易)", params: "instId, ordId", what: "事件合约撤单 — WRITE" },
        { name: "okx_event_amend_order", auth: "API Key (交易)", params: "instId, ordId, newSz?", what: "事件合约改单 — WRITE" },
        { name: "okx_event_fills", auth: "API Key", params: "instId?", what: "事件合约成交记录" },
        { name: "okx_predictions_place_order", auth: "API Key (交易)", params: "marketId, side, price, size", what: "预测市场下单 — WRITE" },
        { name: "okx_predictions_positions", auth: "API Key", params: "marketId?", what: "预测市场持仓" },
        { name: "okx_predictions_order_list", auth: "API Key", params: "marketId?, status?", what: "预测市场订单列表" },
        { name: "okx_predictions_redeem", auth: "API Key (交易)", params: "marketId, outcome", what: "预测市场赎回 — WRITE" },
        { name: "okx_predictions_balance", auth: "API Key", params: "无", what: "预测市场余额" },
      ],
    },
    "技术指标": {
      workflow: "okx_indicator 单指标计算 → 需要综合判断时 okx_indicator_batch 批量计算",
      tools: [
        { name: "okx_indicator", auth: "公开", params: "instId, indicator, period?, bar?", what: "单指标计算+Agent信号解读（17种指标含RSI/MACD/BB/ATR/ADX等）" },
        { name: "okx_indicator_batch", auth: "公开", params: "instId, indicators(逗号分隔), bar?", what: "多指标批量计算+综合信号共识（最多10个指标）" },
      ],
    },
    "聪明钱": {
      workflow: "okx_smart_leaderboard 看排行 → okx_smart_trader_detail 深挖 → okx_smart_sentiment 看情绪",
      tools: [
        { name: "okx_smart_leaderboard", auth: "公开", params: "instType?, sortBy?, topN?", what: "交易员排行榜（按收益率/总收益/跟单人数排序）" },
        { name: "okx_smart_trader_detail", auth: "公开", params: "uniqueCode, instType?", what: "单交易员全景：收益率+胜率+回撤+持仓+PnL曲线" },
        { name: "okx_smart_sentiment", auth: "公开", params: "instFamily?", what: "市场情绪仪表盘：多空比+PCR+资金费率 → 量化评分(0-100)" },
      ],
    },
    "WebSocket 实时": {
      workflow: "okx_ws_subscribe 订阅频道 → okx_ws_events 拉取事件",
      tools: [
        { name: "okx_ws_subscribe", auth: "公开", params: "channels[]", what: "订阅实时频道（tickers/trades/books/candles/fundingRate 等）" },
        { name: "okx_ws_events", auth: "公开", params: "channel?", what: "收取订阅的实时推送事件" },
        { name: "okx_ws_status", auth: "公开", params: "无", what: "当前订阅状态" },
        { name: "okx_ws_close", auth: "公开", params: "channel?", what: "取消订阅" },
      ],
    },
    "模拟估算": {
      workflow: "agent_simulate_order（预估）→ 用户确认 → agent_quick_trade（真实下单）",
      tools: [
        { name: "agent_simulate_order", auth: "API Key (只读)", params: "instId, side, sz, tdMode, px?", what: "模拟下单：成交价/滑点/手续费/资金占用 全预估" },
        { name: "okx_preflight_check", auth: "API Key (只读)", params: "instId, tdMode, sz, px?, side?, ordType?", what: "下单预检：最大可开/限价/合约换算" },
        { name: "okx_position_builder", auth: "API Key (交易)", params: "body(JSON)", what: "组合保证金试算 — WRITE" },
      ],
    },
    "系统工具": {
      workflow: "按需调用，各工具独立",
      tools: [
        { name: "agent_catalog", auth: "公开", params: "无", what: "你正在看的这个" },
        { name: "agent_catalog_detail", auth: "公开", params: "domain", what: "查看某个域的详细工具清单" },
        { name: "agent_get_preference", auth: "公开", params: "key?", what: "读取 Agent 持久化偏好" },
        { name: "agent_set_preference", auth: "公开", params: "key, value", what: "保存 Agent 偏好" },
        { name: "okx_agent_feedback", auth: "公开", params: "title, what, tools, pain, suggestion", what: "提交使用反馈" },
        { name: "agent_hub_status", auth: "公开", params: "无", what: "Agent 集群状态" },
        { name: "agent_hub_dispatch", auth: "公开", params: "taskId, agentId?", what: "派发任务给 Agent" },
        { name: "agent_hub_review", auth: "公开", params: "taskId, verdict, feedback?", what: "审核 Agent 提交结果" },
        { name: "agent_room_send", auth: "公开", params: "roomId, text", what: "发送房间消息" },
        { name: "agent_room_view", auth: "公开", params: "roomId?, limit?", what: "查看房间消息历史" },
        { name: "xlayer_subscribe", auth: "公开", params: "channel, address?", what: "X Layer 链上事件订阅" },
        { name: "xlayer_call", auth: "公开", params: "to, data, value?", what: "X Layer 合约调用 — WRITE" },
        { name: "xlayer_get_events", auth: "公开", params: "channel?", what: "X Layer 链上事件" },
        { name: "okx_get_system_status", auth: "公开", params: "无", what: "OKX 系统状态" },
        { name: "okx_get_instruments", auth: "公开", params: "instType, instId?", what: "产品列表/详情" },
      ],
    },
  }

  server.tool(
    "agent_catalog_detail",
    "CAT:[系统] | ## 功能：查看某个业务域的详细工具清单——含每个工具的参数提示、鉴权要求、推荐调用顺序\n## 场景：Agent 在 agent_catalog 确定域后，调用此工具获取该域所有工具的精准信息、参数提示和典型 workflow\n## 关键词：目录详情, catalog detail, 工具清单, 域详情, workflow\n## 参数：\n##   - domain: 域名称。可取值: 账户资产 | 行情看盘 | 下单交易 | 风险风控 | 市场扫描 | 盈亏复盘 | 资金管理 | 策略交易 | 预测市场 | WebSocket 实时 | 模拟估算 | 系统工具\n## 鉴权：PUBLIC — 纯索引\n## 风险：READ — 只读\n## 返回量：微小 ~2KB — 单域详情\n## 关联：agent_catalog 选域 → 本工具获取详情 → 直接调用目标工具",
    {
      domain: z.string().describe("域名称。可选: 账户资产, 行情看盘, 技术指标, 下单交易, 风险风控, 市场扫描, 聪明钱, 盈亏复盘, 资金管理, 策略交易, 预测市场, WebSocket 实时, 模拟估算, 系统工具"),
    },
    async ({ domain }) => {
      try {
        const detail = DOMAIN_DETAILS[domain]
        if (!detail) {
          return toResult({
            found: false,
            domain,
            availableDomains: Object.keys(DOMAIN_DETAILS),
            hint: "请从 availableDomains 中选择一个域，或调 agent_catalog 查看完整导航",
            tsIso: new Date().toISOString(),
          })
        }
        return toResult({
          found: true,
          domain,
          ...detail,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )
}
