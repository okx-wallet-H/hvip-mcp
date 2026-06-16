import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED } from "./shared.js"

// ════════════════════════════════════════════════════════════════════════════
// Smart Money 模块
//
// 基于 OKX 公开 Copy Trading Leaderboard API + Rubik 交易大数据，
// 提供交易员洞察和市场情绪分析。
// 官方 Agent Trade Kit 使用内部端点（orbit/journal），hvip 用公开 API 替代。
// ════════════════════════════════════════════════════════════════════════════

export function registerSmartMoneyTools(server: McpServer, auth: Auth | null): void {

  // ── okx_smart_leaderboard ──────────────────────────────────────────────
  server.tool(
    "okx_smart_leaderboard",
    "CAT:[Smart Money] | → 请先调用 agent_catalog",
    {
      instType: z.enum(["SPOT","SWAP"]).optional().describe("产品类型，默认SPOT"),
      sortBy:   z.enum(["pnl","totalPnl","followers"]).optional().describe("排序。pnl=收益率, totalPnl=总收益, followers=跟单人数"),
      topN:     z.number().int().min(3).max(50).optional().describe("返回条数，默认10"),
    },
    async ({ instType, sortBy, topN }) => {
      try {
        const it = instType || "SPOT"
        const n = topN || 10
        const sb = sortBy || "pnl"

        const raw = await publicApi.getPublicLeadTraders() as any[]
        if (!raw || raw.length === 0) {
          return toResult({ leaderboard: [], count: 0, message: "暂无交易员数据", tsIso: new Date().toISOString() })
        }

        const traders = raw.map((t: any) => ({
          uniqueCode: t.uniqueCode,
          nickName: t.nickName,
          instType: it,
          pnl: parseFloat(t.pnl ?? "0"),
          totalPnl: parseFloat(t.totalPnl ?? "0"),
          winRate: parseFloat(t.winRate ?? "0"),
          drawdown: t.maxDrawdown,
          followers: parseInt(t.followerCount ?? "0"),
          sharpeRatio: t.sharpeRatio,
          profitSharingRatio: t.profitSharingRatio,
          filledPnL: parseFloat(t.filledPnl ?? "0"),
          beginTs: t.beginTs ? new Date(parseInt(t.beginTs)).toISOString() : undefined,
        })).filter((t: any) => t.pnl > 0 || t.totalPnl > 0)

        // 排序
        if (sb === "pnl") traders.sort((a: any, b: any) => b.pnl - a.pnl)
        else if (sb === "totalPnl") traders.sort((a: any, b: any) => b.totalPnl - a.totalPnl)
        else traders.sort((a: any, b: any) => b.followers - a.followers)

        const top = traders.slice(0, n)

        return toResult({
          leaderboard: top.map((t, i) => ({ rank: i + 1, ...t, pnl: t.pnl.toFixed(2) + "%", totalPnl: "$" + t.totalPnl.toFixed(2) })),
          total: traders.length,
          sortBy: sb,
          _summary: `🏆 ${it} 交易员排行榜 Top${n}: ${top.slice(0, 3).map((t: any) => `${t.nickName}(${t.pnl.toFixed(1)}%)`).join(" | ")}。共 ${traders.length} 位交易员。`,
          tip: "想看某位交易员的详细数据，用 okx_smart_trader_detail { uniqueCode }",
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── okx_smart_trader_detail ────────────────────────────────────────────
  server.tool(
    "okx_smart_trader_detail",
    "CAT:[Smart Money] | → 请先调用 agent_catalog",
    {
      uniqueCode: z.string().describe("交易员唯一码（如 A12345678）"),
      instType:   z.enum(["SPOT","SWAP"]).optional().describe("产品类型，默认SPOT"),
    },
    async ({ uniqueCode, instType }) => {
      try {
        const it = instType || "SPOT"
        const [stats, pnl, positions] = await Promise.allSettled([
          publicApi.getPublicLeadTraderStats(uniqueCode, it, "30"),
          publicApi.getPublicLeadTraderPnl(uniqueCode, "30"),
          publicApi.getLeadTraderPositions(uniqueCode, it),
        ])

        const sOk = stats.status === "fulfilled" ? (stats.value as any[])?.[0] ?? {} : {}
        const pOk = pnl.status === "fulfilled" ? (pnl.value as any[]) ?? [] : []
        const posOk = positions.status === "fulfilled" ? (positions.value as any[]) ?? [] : []

        // 当前持仓摘要
        const currentPos = posOk
          .filter((p: any) => parseFloat(p.pos || "0") !== 0)
          .map((p: any) => ({
            instId: p.instId,
            posSide: p.posSide,
            pos: p.pos,
            avgPx: p.avgOpenPx,
            markPx: p.markPx,
            upl: p.upl,
            uplRatio: p.uplRatio,
            lever: p.lever,
          }))

        // 近期 PnL 曲线
        const pnlCurve = pOk.slice(0, 30).map((p: any) => ({
          date: p.ts ? new Date(parseInt(p.ts)).toISOString().slice(0, 10) : undefined,
          pnl: parseFloat(p.pnl ?? "0").toFixed(2),
        }))

        return toResult({
          uniqueCode,
          profile: {
            nickName: (sOk as any).nickName,
            pnl: parseFloat((sOk as any).pnl ?? "0").toFixed(2) + "%",
            totalPnl: "$" + parseFloat((sOk as any).totalPnl ?? "0").toFixed(2),
            winRate: parseFloat((sOk as any).winRate ?? "0").toFixed(1) + "%",
            maxDrawdown: (sOk as any).maxDrawdown,
            sharpeRatio: (sOk as any).sharpeRatio,
            totalEquity: (sOk as any).totalEquity,
            followerCount: (sOk as any).followerCount,
            tradesPerDay: (sOk as any).tradesPerDay,
            avgHoldingHours: (sOk as any).avgHoldingHours,
          },
          positions: {
            activeCount: currentPos.length,
            list: currentPos,
          },
          pnlTimeline: pnlCurve,
          _summary: `${(sOk as any).nickName || uniqueCode}: ${(sOk as any).pnl || "?"}% 收益率，${(sOk as any).winRate || "?"}% 胜率，${currentPos.length} 个当前持仓。最大回撤 ${(sOk as any).maxDrawdown || "?"}。`,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── okx_smart_sentiment ────────────────────────────────────────────────
  server.tool(
    "okx_smart_sentiment",
    "CAT:[Smart Money] | → 请先调用 agent_catalog",
    {
      instFamily: z.string().optional().describe("产品族，如 BTC-USD、ETH-USD。默认 BTC-USD"),
    },
    async ({ instFamily }) => {
      try {
        const family = instFamily || "BTC-USD"
        const instId = family.replace("-", "-") + "-SWAP"

        const ccy = family.split("-")[0] // BTC-USD → BTC

        // 并行：多空比 + PCR + 资金费率 + Top交易员多空比
        const fetchers: Record<string, Promise<unknown>> = {
          lsRatio:     publicApi.getLongShortRatio(ccy),
          pcr:         publicApi.getOptionPutCallRatio(ccy),
          fundingRate: publicApi.getFundingRate(instId),
          topLSRatio:  publicApi.getTopTraderLongShortRatio(instId),
        }

        const entries = Object.entries(fetchers)
        const keys = entries.map(e => e[0])
        const results = await Promise.allSettled(entries.map(e => e[1]))

        const get = (name: string) => {
          const idx = keys.indexOf(name)
          if (idx < 0) return null
          if (results[idx].status === "rejected") return null
          return (results[idx] as PromiseFulfilledResult<any>).value
        }

        // 多空比
        const lsArr = (get("lsRatio") as any[]) ?? []
        const ls = lsArr[0]
        const lsRatio = parseFloat((ls as any)?.lsRatio ?? "0")
        const lsRatioPrev = parseFloat((ls as any)?.lsRatioPrev ?? lsRatio)

        // PCR（看跌/看涨比）
        const pcrArr = (get("pcr") as any[]) ?? []
        const pcr = pcrArr[0]
        const pcrRatio = parseFloat((pcr as any)?.pcrRatio ?? "0")

        // 资金费率
        const frArr = (get("fundingRate") as any[]) ?? []
        const fr = frArr[0]
        const fundingRate = parseFloat((fr as any)?.fundingRate ?? "0")

        // 顶级交易员多空比
        const topLSArr = (get("topLSRatio") as any[]) ?? []
        const topLS = topLSArr[0]
        const topLsRatio = parseFloat((topLS as any)?.lsRatio ?? "0")

        // ── 情绪评分（0-100，>50偏多，<50偏空） ──
        let score = 50

        // 多空比：>1.2偏多，<0.8偏空
        if (lsRatio > 1.5) score += 15
        else if (lsRatio > 1.2) score += 8
        else if (lsRatio < 0.8) score -= 8
        else if (lsRatio < 0.5) score -= 15

        // Top交易员 vs 散户分歧
        if (topLsRatio > 1.2 && lsRatio < 1.0) score += 10 // 聪明钱做多，散户做空 → 偏多

        // PCR：>1偏空（更多人买Put），<0.5偏多
        if (pcrRatio > 1.2) score -= 12
        else if (pcrRatio > 0.8) score -= 5
        else if (pcrRatio < 0.5) score += 5
        else if (pcrRatio < 0.3) score += 10

        // 资金费率：极度正值 → 市场过热偏空信号
        if (fundingRate > 0.001) score -= 10
        else if (fundingRate > 0.0005) score -= 5
        else if (fundingRate < -0.0005) score += 5

        score = Math.max(0, Math.min(100, score))

        const sentiment = score >= 70 ? "🟢 极度看多" : score >= 55 ? "🟢 偏多" : score >= 45 ? "🟡 中性" : score <= 30 ? "🔴 极度看空" : "🔴 偏空"

        const signals: string[] = []
        if (lsRatio > 1.5) signals.push(`多空比 ${lsRatio.toFixed(2)} 极高，散户高度看多（警惕反转）`)
        else if (lsRatio > 1.2) signals.push(`多空比 ${lsRatio.toFixed(2)}，散户偏多`)
        else if (lsRatio < 0.8) signals.push(`多空比 ${lsRatio.toFixed(2)}，散户偏空`)
        if (topLsRatio > 1.2 && lsRatio < 1.0) signals.push("聪明钱（Top交易员）与散户方向分歧：聪明钱看多，散户看空")
        if (pcrRatio > 1) signals.push(`PCR ${pcrRatio.toFixed(2)}，期权市场避险情绪重（更多人买Put）`)
        else if (pcrRatio < 0.5) signals.push(`PCR ${pcrRatio.toFixed(2)}，期权市场看涨情绪浓（买Call为主）`)
        if (Math.abs(fundingRate) > 0.001) signals.push(`资金费率 ${(fundingRate * 100).toFixed(3)}%，${fundingRate > 0 ? "多头拥挤，注意回调" : "空头拥挤，注意轧空"}`)

        return toResult({
          instFamily,
          timestamp: new Date().toISOString(),
          sentiment: { score, label: sentiment },
          metrics: {
            lsRatio: { value: lsRatio.toFixed(2), change: (lsRatio - lsRatioPrev).toFixed(2), label: "多空比（散户）" },
            topLsRatio: { value: topLsRatio.toFixed(2), label: "多空比（Top交易员）" },
            pcr: { value: pcrRatio.toFixed(2), label: "Put/Call Ratio" },
            fundingRate: { value: (fundingRate * 100).toFixed(4) + "%", label: "资金费率" },
          },
          signals,
          _summary: `${family} 市场情绪: ${sentiment}（评分 ${score}/100）。${signals.slice(0, 2).join("。")}`,
          tip: "情绪评分仅作参考，不构成投资建议。结合技术指标和风险管理决策。",
        })
      } catch (e) { return toError(e) }
    }
  )
}
