import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError, INST_TYPE_RUBIK, INST_TYPE_SWAP_FUT } from "./shared.js"

export function registerStatsTools(server: McpServer): void {
  server.tool(
    "okx_get_long_short_ratio",
    "## 功能：获取合约多空账户比例\n## 场景：用于判断市场情绪（比值>1多头多，>3或<0.3往往是反转信号）、结合价格方向做决策\n## 关键词：多空比, long short ratio, 市场情绪, 散户情绪, 多空账户\n## 参数：\n##   - ccy: 币种，如 BTC、ETH\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_top_trader_long_short_ratio 看大户 → 本工具看散户 → 对比背离信号",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getLongShortRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_taker_volume",
    "## 功能：获取主动买卖量统计\n## 场景：用于判断资金流向（主动买量>卖量=多头）、分析趋势强度\n## 关键词：主动买卖量, taker volume, 资金流向, 买卖力量, 主动性买盘\n## 参数：\n##   - ccy: 币种，如 BTC\n##   - instType: 产品类型。SPOT=现货, CONTRACTS=合约\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_taker_flow 看Taker流向 → 本工具看成交量 → 结合 okx_get_ticker 判断趋势",
    {
      ccy:      z.string().describe("币种，如 BTC"),
      instType: z.enum(INST_TYPE_RUBIK).describe("产品类型"),
      begin:    z.string().optional().describe("开始时间戳（毫秒）"),
      end:      z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, instType, begin, end }) => {
      try {
        const data = await publicApi.getTakerVolume(ccy, instType, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_open_interest_volume",
    "## 功能：获取持仓量与成交量统计\n## 场景：用于判断投机活跃度（持仓量/成交量比值上升=投机增加）、验证趋势可持续性\n## 关键词：持仓成交比, open interest volume, 投机度, 量仓关系, OI比率\n## 参数：\n##   - ccy: 币种，如 BTC\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_open_interest 查当前持仓 → 本工具看历史量仓关系 → 判断趋势是否健康",
    {
      ccy:   z.string().describe("币种，如 BTC"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOpenInterestVolume(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_margin_lending_ratio",
    "## 功能：获取杠杆借币利率及借币量\n## 场景：用于判断杠杆投机热度（借币量增加=杠杆在积累）、短期行情加速的先行指标\n## 关键词：杠杆借币, margin lending, 借币利率, 杠杆率, 保证金借贷\n## 参数：\n##   - ccy: 币种，如 BTC、USDT\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：okx_get_lending_rate_summary 看市场利率 → 本工具看借币量趋势 → 判断杠杆水平",
    { ccy: z.string().describe("币种，如 BTC、USDT") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateHistory(ccy)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_stats_support_coin",
    "## 功能：获取交易大数据模块支持查询的所有币种列表\n## 场景：用于在调用其他交易大数据接口前确认币种可用、避免查询不支持的币种\n## 关键词：支持币种, support coin, 数据可用币种, 统计币种列表\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具获取可用币种 → okx_get_long_short_ratio 等多空比类工具",
    {},
    async () => {
      try {
        const data = await publicApi.getSupportCoin()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_top_trader_long_short_ratio",
    "## 功能：获取精英交易员多空持仓比例（仅统计前5%大户）\n## 场景：用于判断大户持仓方向（比散户数据更具预测价值）、散户与大户背离时往往是逆势信号\n## 关键词：大户多空比, top trader ratio, 精英交易员, 聪明钱, 大户持仓\n## 参数：\n##   - instId: 合约产品ID，如 BTC-USDT-SWAP、ETH-USDT-SWAP\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_long_short_ratio 看散户 → 本工具看大户 → 对比找到背离 → 逆势交易信号",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP、ETH-USDT-SWAP"),
      begin:  z.string().optional().describe("开始时间戳（毫秒）"),
      end:    z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ instId, begin, end }) => {
      try {
        const data = await publicApi.getTopTraderLongShortRatio(instId, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_put_call_ratio",
    "## 功能：获取期权Put/Call比（未平仓量和成交量）\n## 场景：用于衡量期权市场情绪（Put/Call>1=看跌）、判断市场风险偏好\n## 关键词：Put/Call比, put call ratio, 期权情绪, 看跌看涨比, PCR\n## 参数：\n##   - ccy: 币种，如 BTC、ETH\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_opt_summary 看期权概览 → 本工具看Put/Call比 → 判断市场多空情绪",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOptionPutCallRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_lending_rate_summary",
    "## 功能：获取活期借币当前市场利率汇总（公开数据，无需API Key）\n## 场景：用于判断借贷成本、寻找闲置资金的最优出借利率、比较各币种借贷利率\n## 关键词：借币利率, lending rate, 借贷成本, 出借利率, 市场利率\n## 参数：\n##   - ccy: 币种，如 BTC、USDT。不填返回全部\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具看市场利率 → okx_get_margin_lending_ratio 看借币量 → 判断杠杆热度",
    { ccy: z.string().optional().describe("币种，如 BTC、USDT，不填返回全部") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateSummary(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_top_traders_contract_ls_ratio",
    "## 功能：获取精英交易员多空持仓比例（全部合约汇总）\n## 场景：用于判断精英群体整体持仓方向、分析大户情绪变化趋势、发现极端持仓的转折信号\n## 关键词：精英多空比, 全部合约, top traders LS ratio, 大户情绪, 持仓汇总\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。可选，不填返回全部\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_top_trader_long_short_ratio 看单一合约大户 → 本工具看全部合约汇总 → 判断整体大户方向",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getTopTradersContractLSRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_contracts_taker_volume",
    "## 功能：获取合约主动买卖量统计（全部合约汇总）\n## 场景：用于判断整体合约市场的买卖力量对比、分析全市场资金流向趋势\n## 关键词：合约买卖量, contracts taker volume, 主动买卖, 全部合约, 买卖力量\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。可选，不填返回全部\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_taker_volume 看分类型买卖量 → 本工具看全部合约汇总 → 判断整体市场方向",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsTakerVolume(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_contracts_long_short_ratio",
    "## 功能：获取全部合约多空持仓比例（多空比）\n## 场景：用于判断整体合约市场情绪（>1多头偏多，<1空头偏多）、发现极端情绪的转折信号\n## 关键词：合约多空比, contracts LS ratio, 全部合约持仓, 市场情绪, 多空账户比\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。可选，不填返回全部\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_long_short_ratio 看分合约多空比 → 本工具看全部合约汇总 → 对比判断情绪方向",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsLongShortRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_long_short_ratio_all",
    "## 功能：获取全部合约的多空持仓比例汇总\n## 场景：用于判断整体合约市场的多空情绪、发现极端比例时的反转信号\n## 关键词：全部合约多空比, long short ratio all, 全市场多空, 多空情绪\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。可选，不填返回全部\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看全市场多空比 → okx_get_long_short_ratio 看分合约 → 对比分析",
    {
      ccy:   z.string().optional().describe("币种，如 BTC、ETH。不填返回全部"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getContractsLongShortRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_taker_flow_contract",
    "## 功能：获取合约主动买卖流向（Taker流量），统计买入和卖出Taker成交量\n## 场景：用于判断合约市场的主动买卖力量对比、追踪聪明钱流向\n## 关键词：主动流向, taker flow contract, 合约主动买卖, Taker流量\n## 参数：\n##   - ccy: 币种，如 BTC。必填\n##   - instType: 产品类型。SWAP/FUTURES。可选\n##   - begin: 开始时间戳（毫秒）。可选\n##   - end: 结束时间戳（毫秒）。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_taker_volume 看成交量 → 本工具看买卖方向 → 判断多空力度",
    {
      ccy:      z.string().describe("币种，如 BTC。必填"),
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型。SWAP=永续, FUTURES=交割"),
      begin:    z.string().optional().describe("开始时间戳（毫秒）"),
      end:      z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, instType, begin, end }) => {
      try {
        const data = await publicApi.getTakerFlow(ccy, instType, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_open_interest_history_rubik",
    "## 功能：获取合约持仓量历史走势（交易大数据）\n## 场景：用于分析持仓量趋势、判断资金流入流出、量价配合分析\n## 关键词：持仓量历史, OI历史, open interest history, rubik, 持仓走势\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - period: 时间粒度。5m/15m/30m/1H/2H/4H/6H/12H/1D/1W。默认5m\n##   - limit: 返回条数，默认100，最大14400\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~5KB — 微小\n## 关联：先调 okx_get_instruments 获取合约产品 → 本工具查持仓趋势 → 结合 okx_get_ticker 判断量价关系",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      period: z.enum(["5m","15m","30m","1H","2H","4H","6H","12H","1D","1W"]).optional().describe("时间粒度，默认5m"),
      limit:  z.string().optional().describe("返回条数，默认100，最大14400"),
    },
    async ({ instId, period, limit }) => {
      try {
        const data = await publicApi.getOpenInterestHistory(instId, period, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:    row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          oi:    row[1],
          oiCcy: row[2],
          vol:   row[3],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_savings_lending_rate",
    "## 功能：获取活期借币当前市场利率汇总（公开数据，无需API Key）\n## 场景：用于判断借贷成本、寻找闲置资金最优出借利率、比较各币种借贷利率\n## 关键词：借币利率, lending rate, 借贷成本, 出借利率, 市场利率\n## 参数：\n##   - ccy: 币种，如 BTC、USDT。不填返回全部\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具看市场利率 → 判断杠杆成本 → okx_get_margin_lending_ratio 看借币量趋势",
    { ccy: z.string().optional().describe("币种，如 BTC、USDT，不填返回全部") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateSummary(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_margin_lending_ratio_history",
    "## 功能：获取杠杆借币利率历史走势\n## 场景：用于分析借币利率变化趋势、判断杠杆资金成本变化\n## 关键词：借币利率历史, margin lending history, 利率走势, 杠杆成本\n## 参数：\n##   - ccy: 币种，如 BTC、USDT\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看利率历史 → okx_get_margin_lending_ratio 看当前 → 判断杠杆变化",
    { ccy: z.string().describe("币种，如 BTC、USDT") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getLendingRateHistory(ccy)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_open_interest",
    "## 功能：获取期权未平仓量和成交量\n## 场景：用于分析期权市场活跃度、判断资金流入流出趋势\n## 关键词：期权持仓, option oi, 期权未平仓, 期权成交量, 期权持仓量\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看期权持仓 → okx_get_put_call_ratio 分析情绪 → okx_get_opt_summary 看波动率",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionOpenInterestVolume(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_oi_expiry",
    "## 功能：按到期日获取期权未平仓量和成交量分布\n## 场景：用于分析不同到期日的期权持仓分布、判断市场焦点到期日\n## 关键词：期权到期持仓, option oi expiry, 到期日分布, 各期限持仓\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具按到期日看持仓 → okx_get_option_open_interest 看总量 → 分析到期日集中度",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionOiExpiry(ccy)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts: row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          expTime: row[1],
          oi: row[2],
          oiUsd: row[3],
          vol: row[4],
          volUsd: row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_oi_strike",
    "## 功能：按行权价获取期权未平仓量和成交量分布\n## 场景：用于分析不同行权价的期权持仓集中度、发现最大痛点、判断市场预期价格区间\n## 关键词：期权行权持仓, option oi strike, 行权价分布, 最大痛点, max pain\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。必填\n##   - expTime: 到期日，格式 YYYYMMDD。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看行权价分布 → 计算最大痛点 → 预判到期日价格走势",
    {
      ccy: z.string().describe("币种，如 BTC、ETH。必填"),
      expTime: z.string().describe("到期日，格式 YYYYMMDD。必填"),
    },
    async ({ ccy, expTime }) => {
      try {
        const data = await publicApi.getOptionOiStrike(ccy, expTime)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts: row[0],
          tsIso: row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          strike: row[1],
          putOi: row[2],
          callOi: row[3],
          putVol: row[4],
          callVol: row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_long_short_account_ratio",
    "## 功能：获取合约多空账户比例\n## 场景：用于判断市场情绪，比值>1表示多头占多数\n## 关键词：多空账户比, long short account, 市场情绪\n## 参数：\n##   - ccy: 币种，如 BTC、ETH\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看账户多空比 → okx_get_contract_trader_ls_ratio 看大户 → 对比",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getLongShortRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_contract_trader_ls_ratio",
    "## 功能：获取精英交易员合约多空比\n## 场景：用于判断大户对合约市场的看法\n## 关键词：精英多空比, top trader ls, 大户合约\n## 参数：\n##   - instId: 合约产品ID，如 BTC-USDT-SWAP\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看大户多空 → okx_get_long_short_account_ratio 看散户 → 对比",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP"),
      begin:  z.string().optional().describe("开始时间戳（毫秒）"),
      end:    z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ instId, begin, end }) => {
      try {
        const data = await publicApi.getTopTraderLongShortRatio(instId, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_contract_position_trader_ratio",
    "## 功能：获取精英交易员持仓多空比例（按仓位）\n## 场景：用于分析大户实际持仓方向、比账户比例更精确\n## 关键词：精英持仓比, top trader position, 大户仓位\n## 参数：\n##   - instId: 合约产品ID，如 BTC-USDT-SWAP。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看大户仓位多空 → 结合价格判断趋势",
    {
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getTopTraderPositionRatio(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_oi_ratio",
    "## 功能：获取期权未平仓量Call/Put比和成交量比\n## 场景：用于衡量期权市场整体情绪\n## 关键词：期权持仓比, option oi ratio, PCR, 期权情绪\n## 参数：\n##   - ccy: 币种，如 BTC、ETH\n##   - begin: 开始时间戳（毫秒）\n##   - end: 结束时间戳（毫秒）\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看期权比 → okx_get_option_open_interest 看持仓总量",
    {
      ccy:   z.string().describe("币种，如 BTC、ETH"),
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
    },
    async ({ ccy, begin, end }) => {
      try {
        const data = await publicApi.getOptionPutCallRatio(ccy, begin, end)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_taker_block_volume",
    "## 功能：获取期权主动成交和区块成交的统计\n## 场景：用于分析期权市场的Taker成交量和区块成交量\n## 关键词：期权成交量, option taker block, 期权主动买卖, 期权大单\n## 参数：\n##   - ccy: 币种，如 BTC、ETH。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看期权成交量 → okx_get_option_open_interest 看持仓 → 分析活跃度",
    { ccy: z.string().describe("币种，如 BTC、ETH。必填") },
    async ({ ccy }) => {
      try {
        const data = await publicApi.getOptionTakerBlockVolume(ccy)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_taker_volume_contract",
    "## 功能：获取合约主动买卖量统计（按合约）\n## 场景：用于查看具体合约的主动买卖力量\n## 关键词：合约买卖量, taker volume contract, 主动成交\n## 参数：\n##   - ccy: 币种，如 BTC。必填\n##   - instId: 合约产品ID，如 BTC-USDT-SWAP。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查单合约买卖量 → okx_get_contracts_taker_volume 查汇总",
    {
      ccy:    z.string().describe("币种，如 BTC。必填"),
      instId: z.string().describe("合约产品ID，如 BTC-USDT-SWAP。必填"),
    },
    async ({ ccy, instId }) => {
      try {
        const data = await publicApi.getTakerVolumeContract(ccy, instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
