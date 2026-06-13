import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

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
        const [balance, positions, config, valuation] = await Promise.allSettled([
          privateApi.getBalance(auth),
          privateApi.getPositions(auth),
          privateApi.getAccountConfig(auth),
          privateApi.getAssetValuation(auth),
        ])

        // ── 余额摘要 ──
        const balanceData = balance.status === "fulfilled" ? (balance.value as any[]) : []
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
        const posData = positions.status === "fulfilled" ? (positions.value as any[]) : []
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
        const cfg = config.status === "fulfilled" ? (config.value as any[])?.[0] ?? {} : {}

        // ── 总估值 ──
        const val = valuation.status === "fulfilled" ? (valuation.value as any[])?.[0] ?? {} : {}

        const overview = {
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

          errors: [
            balance.status === "rejected" ? `余额查询失败: ${(balance.reason as any)?.message}` : null,
            positions.status === "rejected" ? `持仓查询失败: ${(positions.reason as any)?.message}` : null,
            config.status === "rejected" ? `配置查询失败: ${(config.reason as any)?.message}` : null,
            valuation.status === "rejected" ? `估值查询失败: ${(valuation.reason as any)?.message}` : null,
          ].filter(Boolean),
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
        // 从 instId 推断 instType 以查产品规格
        const isSwap = instId.toUpperCase().includes("-SWAP")
        const isMargin = instId.toUpperCase().includes("MARGIN")

        // 并行：行情 + 5档深度 + 费率（仅永续）
        const fetchers: [string, Promise<unknown>][] = [
          ["ticker", publicApi.getTicker(instId)],
          ["orderbook", publicApi.getOrderbook(instId, 5)],
        ]
        if (isSwap) {
          fetchers.push(["fundingRate", publicApi.getFundingRate(instId)])
        }

        const keys = fetchers.map(f => f[0])
        const results = await Promise.allSettled(fetchers.map(f => f[1]))

        // ── 行情 ──
        const tickerIdx = keys.indexOf("ticker")
        const tickerRaw = results[tickerIdx]?.status === "fulfilled"
          ? (results[tickerIdx] as PromiseFulfilledResult<any>).value as any[]
          : []
        const tk = tickerRaw.length > 0 ? tickerRaw[0] : {}

        // ── 深度 ──
        const obIdx = keys.indexOf("orderbook")
        const obRaw = results[obIdx]?.status === "fulfilled"
          ? (results[obIdx] as PromiseFulfilledResult<any>).value as any
          : null
        const obData = (obRaw as any)?.data?.[0] ?? obRaw
        const asks = ((obData as any)?.asks ?? []).slice(0, 5)
        const bids = ((obData as any)?.bids ?? []).slice(0, 5)
        const spread = asks.length > 0 && bids.length > 0
          ? (parseFloat(asks[0]?.[0] ?? "0") - parseFloat(bids[0]?.[0] ?? "0")).toFixed(2)
          : "N/A"

        // ── 费率 ──
        let fundingRate: any = null
        if (isSwap) {
          const frIdx = keys.indexOf("fundingRate")
          const frRaw = results[frIdx]?.status === "fulfilled"
            ? (results[frIdx] as PromiseFulfilledResult<any>).value as any[]
            : []
          const fr = frRaw.length > 0 ? frRaw[0] : {}
          fundingRate = {
            fundingRate: (fr as any).fundingRate,
            nextFundingTime: (fr as any).nextFundingTime
              ? new Date(parseInt((fr as any).nextFundingTime)).toISOString()
              : undefined,
          }
        }

        const summary = {
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
            top5Asks: asks.map((a: any) => ({ px: a[0], sz: a[1], orders: a[3] })),
            top5Bids: bids.map((b: any) => ({ px: b[0], sz: b[1], orders: b[3] })),
          },

          fundingRate,

          errors: results
            .map((r, i) => r.status === "rejected" ? `${keys[i]}失败: ${(r.reason as any)?.message}` : null)
            .filter(Boolean),
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
        // 并行：最大可开 + 限价 + 合约换算 + 行情
        const calls: [string, Promise<unknown>][] = [
          ["maxSize", privateApi.getMaxSize(auth, instId, tdMode)],
          ["priceLimit", publicApi.getPriceLimitBatch("", undefined, instId)],
          ["convertCoin", publicApi.convertContractCoin(instId, sz, "coin", "open")],
          ["ticker", publicApi.getTicker(instId)],
        ]

        const keys = calls.map(c => c[0])
        const results = await Promise.allSettled(calls.map(c => c[1]))

        const get = (name: string) => {
          const idx = keys.indexOf(name)
          if (idx < 0) return null
          return results[idx].status === "fulfilled" ? (results[idx] as any).value : null
        }

        // ── 最大可开 ──
        const maxSizeData = get("maxSize") as any[]
        const maxSz = maxSizeData?.[0]

        // ── 限价 ──
        const limitData = get("priceLimit") as any[]
        const limit = limitData?.[0]

        // ── 合约换算 ──
        const convertData = get("convertCoin") as any[]
        const converted = convertData?.[0]

        // ── 当前价 ──
        const tickerData = get("ticker") as any[]
        const tk = tickerData?.[0] ?? {}

        // ── 组装结果 ──
        const checks: any = {
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
                  ? parseFloat(px) >= parseFloat((limit as any).lowest ?? "0") &&
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
          errors: results
            .map((r, i) => r.status === "rejected" ? `${keys[i]}查询失败: ${(r.reason as any)?.message}` : null)
            .filter(Boolean) as string[],
        }

        // ── 生成告警 ──
        if (limit && px) {
          const lowest = parseFloat((limit as any).lowest ?? "0")
          const highest = parseFloat((limit as any).highest ?? "Infinity")
          const price = parseFloat(px)
          if (price < lowest) checks.warnings.push(`价格 ${px} 低于下限 ${(limit as any).lowest}`)
          if (price > highest) checks.warnings.push(`价格 ${px} 高于上限 ${(limit as any).highest}`)
        }
        if (maxSz && side) {
          const maxBuy = parseFloat((maxSz as any).maxBuy ?? "0")
          const maxSell = parseFloat((maxSz as any).maxSell ?? "0")
          const qty = parseFloat(sz)
          if (side === "buy" && qty > maxBuy) checks.warnings.push(`数量 ${sz} 超过最大可买 ${(maxSz as any).maxBuy}`)
          if (side === "sell" && qty > maxSell) checks.warnings.push(`数量 ${sz} 超过最大可卖 ${(maxSz as any).maxSell}`)
        }
        if (converted) {
          const contractSz = (converted as any).sz
          if (parseFloat(contractSz ?? "0") < 1) checks.warnings.push(`换算后张数 ${contractSz} < 1，可能无法下单`)
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
}
