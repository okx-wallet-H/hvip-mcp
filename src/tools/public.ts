import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi, privateApi, type Auth } from "../adapters/okx.js"
import { toResult, toError, AUTH_REQUIRED, INST_TYPE_TRADE, INST_TYPE_PUBLIC, INST_TYPE_CONTRACTS, INST_TYPE_SWAP_FUT, INST_TYPE_MARGIN_PUB } from "./shared.js"

export function registerPublicTools(server: McpServer, auth: Auth | null): void {
  server.tool(
    "okx_get_instruments",
    "## 功能：获取OKX可交易产品列表，含产品规格、最小下单量、手续费等级等信息\n## 场景：用于确认某产品是否可交易、获取精度参数、下单前验证产品规格\n## 关键词：产品列表, instruments, 可交易品种, 规格参数, 最小下单, 精度\n## 参数：\n##   - instType: 产品类型。SPOT=现货, MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权\n##   - instId: 指定产品ID，不填则返回全量。不传instType将返回全量数据(~200KB)，已自动截断top20\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单类型 ~50KB，全量 ~200KB（已自动截断 top 20）\n## 关联：几乎所有工具的前置工具 → 获取 instId/instFamily 后用于 okx_get_ticker、okx_place_order 等",
    {
      instType: z.enum(INST_TYPE_TRADE).describe("产品类型"),
      instId: z.string().optional().describe("指定产品ID，不填则返回全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getInstruments(instType, instId)
        const arr = data as any[]
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_funding_rate",
    "## 功能：获取永续合约当前及预测资金费率\n## 场景：用于判断多空博弈强度、发现极端费率时的均值回归机会、计算套利持仓成本\n## 关键词：资金费率, 费率, funding rate, 永续, 多头付空头, 套利成本, SWAP\n## 参数：\n##   - instId: 永续合约产品ID，如 BTC-USDT-SWAP\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~1KB — 微小\n## 关联：先调 okx_get_instruments(instType=SWAP) 获取可交易合约 → 本工具查费率 → 结合 okx_get_ticker 计算套利空间",
    { instId: z.string().describe("永续合约产品ID，如 BTC-USDT-SWAP") },
    async ({ instId }) => {
      try {
        const data = await publicApi.getFundingRate(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          fundingTimeIso: item.fundingTime ? new Date(parseInt(item.fundingTime)).toISOString() : undefined,
          nextFundingTimeIso: item.nextFundingTime ? new Date(parseInt(item.nextFundingTime)).toISOString() : undefined,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_mark_price",
    "获取标记价格。标记价格用于计算浮动盈亏和强平价格，与指数价格偏差过大时存在套利空间。不传instId返回全量(~30KB)，已自动截断top20。",
    {
      instType: z.enum(INST_TYPE_PUBLIC).describe("产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId: z.string().optional().describe("产品ID，不填则返回该类型全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getMarkPrice(instType, instId)
        const arr = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_index_price",
    "获取指数价格（多交易所加权均价）。用于判断现货市场整体价格基准，与标记价格对比可发现偏差。",
    { instId: z.string().describe("指数产品ID，如 BTC-USDT") },
    async ({ instId }) => {
      try {
        const data = await publicApi.getIndexPrice(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_open_interest",
    "获取合约持仓量。持仓量快速增加通常意味着新资金入场，结合价格方向可判断趋势强度。不传instId返回全量(~77KB)，已自动截断top20。",
    {
      instType: z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP=永续, FUTURES=交割, OPTION=期权"),
      instId: z.string().optional().describe("产品ID，不填则返回全量"),
    },
    async ({ instType, instId }) => {
      try {
        const data = await publicApi.getOpenInterest(instType, instId)
        const arr = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        const top = arr.length > 20 ? arr.slice(0, 20) : arr
        return toResult({ total: arr.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_system_time",
    "获取OKX服务器当前时间戳。用于校准本地时间偏差，确保签名请求的时间戳在有效范围内（±30秒）。",
    {},
    async () => {
      try {
        const data = await publicApi.getSystemTime()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_opt_summary",
    "获取期权市场摘要数据，含各到期日的隐含波动率（IV）、未平仓量和成交量分布。用于期权交易前的整体市场扫描。",
    {
      uly:     z.string().describe("标的指数，如 BTC-USD、ETH-USD"),
      expTime: z.string().optional().describe("到期日筛选，格式 YYYYMMDD，如 20250101"),
    },
    async ({ uly, expTime }) => {
      try {
        const data = await publicApi.getOptSummary(uly, expTime)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_insurance_fund",
    "获取OKX保险基金余额变动历史。保险基金规模反映交易所抵御极端行情的能力，也是衡量平台风险的指标。",
    {
      instType: z.enum(INST_TYPE_MARGIN_PUB).describe("产品类型。MARGIN=杠杆, SWAP=永续, FUTURES=交割, OPTION=期权"),
      uly:      z.string().optional().describe("标的指数，如 BTC-USD（SWAP/FUTURES/OPTION必填）"),
    },
    async ({ instType, uly }) => {
      try {
        const data = await publicApi.getInsuranceFund(instType, uly)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_convert_contract_coin",
    "合约张数与币数互换计算。下合约单时先用此接口换算张数，避免数量填错。",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT-SWAP"),
      sz:      z.string().describe("数量（张数或币数，取决于unit）"),
      unit:    z.enum(["coin","usds","contracts"]).describe("sz的单位：coin=币，contracts=张"),
      opType:  z.enum(["open","close"]).describe("开仓或平仓"),
    },
    async ({ instId, sz, unit, opType }) => {
      try {
        const data = await publicApi.convertContractCoin(instId, sz, unit, opType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_announcements",
    "获取OKX官方公告列表（维护通知、新币上线、活动等）。定期查询可及时了解平台变化，提前做好风险准备。",
    {
      annType: z.string().optional().describe("公告类型ID，不填返回全部。可先调用 okx_get_announcement_types 查询可用类型"),
      lang:    z.enum(["zh-Hans","en-US"]).optional().describe("语言，默认中文"),
    },
    async ({ annType, lang }) => {
      try {
        const data = await publicApi.getAnnouncements(annType, lang)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_announcement_types",
    "## 功能：获取OKX公告分类列表\n## 场景：用于了解可用的公告类型、筛选特定类型的公告\n## 关键词：公告类型, announcement types, 公告分类, 通知类型\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~1KB\n## 关联：本工具获取类型列表 → okx_get_announcements 按类型筛选 → 评估影响",
    {},
    async () => {
      try {
        const data = await publicApi.getAnnouncementTypes()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_price_limit",
    "## 功能：查询产品的限价上下限（涨跌停价格）\n## 场景：用于判断某产品当前是否接近限价、计算可用下单价格区间、极端行情下限价预警\n## 关键词：限价, 涨跌停, price limit, 上下限, 价格保护, 限价单范围\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填，不支持全量查询\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~200B — 微小\n## 关联：先调 okx_get_instruments 获取可交易产品列表 → 本工具查限价范围 → 结合 okx_get_ticker 判断当前价是否接近限价",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填，不支持全量查询"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getPriceLimitBatch("", undefined, instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_position_tiers",
    "## 功能：查询持仓档位表（决定杠杆上限和保证金率）\n## 场景：用于判断不同持仓量对应的最大杠杆、计算保证金需求、评估大仓位爆仓风险、设置杠杆前确认档位限制\n## 关键词：仓位档位, 杠杆限制, position tiers, 保证金率, 持仓上限, 档位表, 杠杆倍数\n## 参数：\n##   - instType: 产品类型。SWAP=永续合约, FUTURES=交割合约。必填\n##   - tdMode: 保证金模式。cross=全仓, isolated=逐仓。必填\n##   - instFamily: 产品族，如 BTC-USDT。与 uly 二选一必填\n##   - uly: 标的指数，如 BTC-USDT。与 instFamily 二选一必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：大型 ~30KB — 单个产品族含数十个档位，数据量大\n## 关联：先调 okx_get_instruments 获取 instFamily → 本工具查档位 → okx_get_leverage_info 设置杠杆",
    {
      instType:   z.enum(INST_TYPE_SWAP_FUT).describe("产品类型。SWAP=永续合约, FUTURES=交割合约"),
      tdMode:     z.enum(["cross","isolated"]).describe("保证金模式。cross=全仓, isolated=逐仓"),
      instFamily: z.string().optional().describe("产品族，如 BTC-USDT。与 uly 二选一必填"),
      uly:        z.string().optional().describe("标的指数，如 BTC-USDT。与 instFamily 二选一必填"),
    },
    async ({ instType, tdMode, instFamily, uly }) => {
      try {
        const data = await publicApi.getPositionTiers(instType, tdMode, instFamily, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_open_interest_history",
    "## 功能：获取合约持仓量历史走势数据\n## 场景：用于分析持仓量趋势（增仓/减仓方向）、判断资金流入流出、结合价格走势判断趋势强度\n## 关键词：持仓量历史, 持仓走势, open interest history, OI变动, 持仓趋势, 资金流入\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - period: 时间粒度。5m/15m/30m/1H/2H/4H/6H/12H/1D/1W。默认5m\n##   - limit: 返回条数，默认100，最大14400\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~5KB — 微小\n## 关联：先调 okx_get_instruments(instType=SWAP) 获取合约产品 → 本工具查持仓趋势 → 结合 okx_get_ticker 判断量价关系",
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
    "okx_get_underlying",
    "## 功能：查询OKX支持的标的指数列表\n## 场景：用于获取可交易的底层资产列表、筛选特定类型的合约标的\n## 关键词：标的指数, 底层资产, underlying, 合约标的, 指数列表\n## 参数：\n##   - instType: 产品类型。SWAP/FUTURES/OPTION。不填返回全部\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：本工具获取标的 → okx_get_instruments 查具体产品 → okx_get_ticker 查行情",
    {
      instType: z.enum(INST_TYPE_CONTRACTS).optional().describe("产品类型。SWAP=永续, FUTURES=交割, OPTION=期权。不填返回全部"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getUnderlying(instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_taker_flow",
    "## 功能：获取主动买卖成交数据（Taker流量）\n## 场景：用于判断多空力量对比（买入Taker多=多头强）、分析资金流向趋势\n## 关键词：主动成交, taker flow, 买卖力量, 资金流向, 主动买卖\n## 参数：\n##   - ccy: 币种，如 BTC。必填\n##   - instType: 产品类型。SWAP/FUTURES。可选\n##   - begin: 开始时间戳(ms)。可选\n##   - end: 结束时间戳(ms)。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_taker_volume 查成交量 → 本工具查Taker流向 → 判断多空方向",
    {
      ccy:      z.string().describe("币种，如 BTC。必填"),
      instType: z.enum(INST_TYPE_SWAP_FUT).optional().describe("产品类型。SWAP=永续, FUTURES=交割"),
      begin:    z.string().optional().describe("开始时间戳(ms)"),
      end:      z.string().optional().describe("结束时间戳(ms)"),
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
    "okx_get_platform_24_volume",
    "## 功能：获取OKX平台24小时总交易量（现货+合约+期权合计），不含特定币种\n## 场景：用于评估交易所整体活跃度、判断市场热度高低、监控平台交易量变化趋势\n## 关键词：平台交易量, 24小时交易量, platform volume, 总成交量, 市场热度, 全平台\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~300B\n## 关联：本工具看全平台热度 → okx_get_ticker 看具体产品 → okx_get_tickers 扫描市场",
    {},
    async () => {
      try {
        const data = await publicApi.getPlatform24Volume()
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_call_auction_details",
    "## 功能：获取产品集合竞价详情，含当前竞价的未匹配量和参考价格\n## 场景：用于开盘前/盘前交易时段查看集合竞价供需、判断开盘价格区间、发现异常竞价\n## 关键词：集合竞价, call auction, 竞价详情, 开盘竞价, 盘前竞价, 未匹配量\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~500B — 微小\n## 关联：本工具查竞价 → okx_get_ticker 看开盘价 → 开盘后 okx_get_candles 跟踪走势",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getCallAuctionDetails(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          auctionEndTimeIso: item.auctionEndTime ? new Date(parseInt(item.auctionEndTime)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_instrument_family_trades",
    `## 功能：按产品族获取期权链最新成交（按期权类型归组）
## 场景：用于快速浏览某BTC/ETH期权链整体成交概况、对比看涨/看跌成交分布、发现大额期权异动
## 关键词：期权族成交, option family trades, 期权链成交, 期权成交概况, 期权成交汇总
## 参数：
##   - instFamily: 产品族，如 BTC-USD。必填
##   - limit: 返回条数，默认不填则返回全部
## 鉴权：PUBLIC — 公开接口，不需要 API Key
## 风险：READ — 只读查询，Agent 可自动调用
## 返回量：中等 ~5KB
## 关联：先调 okx_get_instruments(instType=OPTION) 获取期权产品 → 本工具看族成交 → okx_get_option_trades 看单笔`,
    {
      instFamily: z.string().describe("产品族，如 BTC-USD。必填"),
      limit:      z.number().int().min(1).max(100).optional().describe("返回条数"),
    },
    async ({ instFamily, limit }) => {
      try {
        const data = await publicApi.getOptionInstrumentFamilyTrades(instFamily, limit)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_option_trades",
    `## 功能：获取期权逐笔成交记录
## 场景：用于分析具体期权合约的成交价量分布、判断主动买卖方向、跟踪期权大单
## 关键词：期权成交, option trades, 逐笔期权成交, 期权明细, 期权大单, option fill
## 参数：
##   - instFamily: 产品族，如 BTC-USD。与instId二选一
##   - instId: 期权产品ID，如 BTC-USD-260612-64000-C。与instFamily二选一
##   - limit: 返回条数，默认100，最大100
## 鉴权：PUBLIC — 公开接口，不需要 API Key
## 风险：READ — 只读查询，Agent 可自动调用
## 返回量：100条 ~5KB — 中等
## 关联：okx_get_option_instrument_family_trades 看族概况 → 本工具看逐笔 → okx_get_opt_summary 看波动率`,
    {
      instFamily: z.string().optional().describe("产品族，如 BTC-USD。与instId二选一"),
      instId:     z.string().optional().describe("期权产品ID，如 BTC-USD-260612-64000-C。与instFamily二选一"),
      limit:      z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instFamily, instId, limit }) => {
      try {
        const data = await publicApi.getOptionTrades(instFamily, instId, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_exchange_rate",
    "## 功能：获取OKX平台支持的法定货币汇率（如USD/CNY）\n## 场景：用于将美元计价盈亏换算为本地法币、计算法币出入金金额\n## 关键词：汇率, exchange rate, 法币汇率, USD/CNY, 美元汇率, 人民币汇率\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~100B\n## 关联：本工具查汇率 → 辅助计算盈亏 → 用户了解本地法币价值",
    {},
    async () => {
      try {
        const data = await publicApi.getExchangeRate()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_search_instruments",
    "## 功能：按关键词搜索可交易产品（现货/合约/期权）\n## 场景：用于用户输入产品名称模糊查找 instId、发现新产品、确认某币种有哪些可交易产品\n## 关键词：搜索, 查找产品, search instruments, 产品搜索, 模糊查询, 币种搜索, find instrument\n## 参数：\n##   - keyword: 搜索关键词，如 BTC、ETH、SOL。必填，最少2字符\n##   - instType: 产品类型筛选。不填则搜索全部类型\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB — 最多返回 top 20 匹配结果\n## 关联：本工具搜索产品 → okx_get_ticker 查行情 → okx_place_order 下单",
    {
      keyword:  z.string().min(2).describe("搜索关键词，如 BTC、ETH、SOL。最少2个字符"),
      instType: z.enum(INST_TYPE_TRADE).optional().describe("产品类型筛选，不填搜索全部"),
    },
    async ({ keyword, instType }) => {
      try {
        const types = instType ? [instType] : ["SPOT","SWAP","FUTURES","OPTION"]
        const allResults: any[] = []
        for (const t of types) {
          const data = await publicApi.getInstruments(t) as any[]
          const kw = keyword.toUpperCase()
          const matches = data.filter((item: any) =>
            item.instId?.toUpperCase().includes(kw) ||
            item.baseCcy?.toUpperCase().includes(kw) ||
            item.uly?.toUpperCase().includes(kw) ||
            item.quoteCcy?.toUpperCase().includes(kw)
          )
          allResults.push(...matches)
        }
        const top = allResults.slice(0, 20)
        return toResult({ keyword, total: allResults.length, returned: top.length, data: top })
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_economic_calendar",
    "## 功能：获取经济日历数据（重要经济事件、数据公布时间）\n## 场景：用于追踪宏观经济事件、评估市场波动触发因素、提前准备应对重要数据公布\n## 关键词：经济日历, economic calendar, 经济数据, 宏观经济, 非农, CPI, 利率决议\n## 参数：\n##   - begin: 开始时间戳（毫秒）。可选\n##   - end: 结束时间戳（毫秒）。可选\n##   - limit: 返回条数，默认100。可选\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具获取经济事件 → 预判市场波动 → 结合 okx_get_ticker 监控行情变化",
    {
      begin: z.string().optional().describe("开始时间戳（毫秒）"),
      end:   z.string().optional().describe("结束时间戳（毫秒）"),
      limit: z.string().optional().describe("返回条数，默认100"),
    },
    async ({ begin, end, limit }) => {
      if (!auth) return toError(AUTH_REQUIRED)
      try {
        const data = await privateApi.getEconomicCalendar(auth, begin, end, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // ── 公共数据（第二批新缺口） ──────────────────────────────────────────────

  server.tool(
    "okx_get_index_components",
    "## 功能：获取指数的成分币种及其权重\n## 场景：用于了解指数构成、分析各交易所对指数价格的影响权重\n## 关键词：指数成分, index components, 指数权重, 成分币种, 成分交易所\n## 参数：\n##   - index: 指数名称，如 BTC-USD。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看指数成分 → okx_get_index_tickers 看指数价格 → 分析偏差",
    {
      index: z.string().describe("指数名称，如 BTC-USD。必填"),
    },
    async ({ index }) => {
      try {
        const data = await publicApi.getIndexComponents(index)
        const enriched = typeof data === 'object' && !Array.isArray(data) ? {
          ...data,
          tsIso: (data as any).ts ? new Date(parseInt((data as any).ts)).toISOString() : undefined,
        } : data
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_index_components_market",
    "## 功能：获取市场价格指数的成分数据\n## 场景：用于获取指数成分的最高/最低价、各交易所报价\n## 关键词：市场指数成分, market index components, 市场价格指数\n## 参数：\n##   - index: 指数名称，如 BTC-USD。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查看市场指数成分 → 对比各交易所价差 → 发现套利机会",
    {
      index: z.string().describe("指数名称，如 BTC-USD。必填"),
    },
    async ({ index }) => {
      try {
        const data = await publicApi.getIndexComponents(index)
        const enriched = typeof data === 'object' && !Array.isArray(data) ? {
          ...data,
          tsIso: (data as any).ts ? new Date(parseInt((data as any).ts)).toISOString() : undefined,
        } : data
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_discount_info",
    "## 功能：获取各币种的抵押品折扣率和免息额度\n## 场景：用于了解各币种作为抵押品的价值折扣、计算可用抵押额度\n## 关键词：抵押折扣, discount info, 抵押品折扣率, 免息额度, 担保品\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看折扣率 → 计算实际抵押价值 → okx_get_max_loan 查可借",
    {},
    async () => {
      try {
        const data = await publicApi.getDiscountRateInterestFreeQuota()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_estimated_price",
    "## 功能：获取期权预估行权结算价\n## 场景：用于期权到期前预估结算价、评估期权到期价值\n## 关键词：预估结算, estimated price, 期权结算, 行权预估, 交割预估价\n## 参数：\n##   - instId: 期权产品ID，如 BTC-USD-260612-64000-C。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具看预估结算价 → okx_get_opt_summary 看波动率 → 评估期权价值",
    {
      instId: z.string().describe("期权产品ID，如 BTC-USD-260612-64000-C。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getEstimatedPrice(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  // ── 公共数据补完（v0.2.26 新缺口） ────────────────────────────────────────

  server.tool(
    "okx_get_funding_rate_history",
    "## 功能：获取资金费率历史记录\n## 场景：用于分析历史资金费率变化趋势、计算套利持仓成本\n## 关键词：资金费率历史, funding rate history, 费率走势, 历史资金费率\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - before: 查询此时间戳之后的数据（毫秒）\n##   - after: 查询此时间戳之前的数据（毫秒）\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：okx_get_funding_rate 看当前 → 本工具看历史 → 判断均值回归方向",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, before, after, limit }) => {
      try {
        const data = await publicApi.getFundingRateHistory(instId, before, after, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.fundingTime ? new Date(parseInt(item.fundingTime)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_interest_rate_loan_quota",
    "## 功能：获取各币种的利率和借贷配额信息\n## 场景：用于查看各币种的借贷利率、了解最大可借限额\n## 关键词：利率配额, interest rate quota, 借贷利率, 借款限额\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具查利率配额 → okx_get_interest_accrued 看已计利息 → 计算借贷成本",
    {},
    async () => {
      try {
        const data = await publicApi.getInterestRateLoanQuota()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_premium_history",
    "## 功能：获取合约溢价/折价历史\n## 场景：用于分析合约与现货价格偏差、判断市场情绪\n## 关键词：溢价历史, premium history, 合约溢价, 基差历史\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - period: 时间粒度。1D=日线。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看溢价 → okx_get_ticker 看价格 → 判断期货情绪",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      period: z.string().optional().describe("时间粒度，如 1D"),
    },
    async ({ instId, period }) => {
      try {
        const data = await publicApi.getPremiumHistory(instId, period)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_delivery_exercise_history",
    "## 功能：获取合约交割和期权行权历史\n## 场景：用于查看历史交割价格、了解行权结算情况\n## 关键词：交割历史, delivery history, 行权历史, 合约交割, 期权行权\n## 参数：\n##   - instType: 产品类型。SWAP=永续, FUTURES=交割, OPTION=期权。必填\n##   - uly: 标的指数。可选\n##   - instFamily: 产品族。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看交割历史 → okx_get_opt_summary 看期权摘要 → 了解行权结算",
    {
      instType:   z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP/FUTURES/OPTION。必填"),
      uly:        z.string().optional().describe("标的指数"),
      instFamily: z.string().optional().describe("产品族"),
    },
    async ({ instType, uly, instFamily }) => {
      try {
        const data = await publicApi.getDeliveryExerciseHistory(instType, uly, instFamily)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_settlement_history",
    "## 功能：获取合约结算历史\n## 场景：用于查看合约的每日结算价格和结算时间\n## 关键词：结算历史, settlement history, 合约结算, 每日结算\n## 参数：\n##   - instType: 产品类型。SWAP/FUTURES/OPTION。必填\n##   - instFamily: 产品族。可选\n##   - uly: 标的指数。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看结算历史 → 了解结算价 → 评估浮动盈亏",
    {
      instType:   z.enum(INST_TYPE_CONTRACTS).describe("产品类型。SWAP/FUTURES/OPTION。必填"),
      instFamily: z.string().optional().describe("产品族"),
      uly:        z.string().optional().describe("标的指数"),
    },
    async ({ instType, instFamily, uly }) => {
      try {
        const data = await publicApi.getSettlementHistory(instType, instFamily, uly)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_public_block_trades",
    "## 功能：获取大宗交易公开成交记录\n## 场景：用于查看大宗市场历史成交、分析大宗价格趋势\n## 关键词：大宗成交, block trades, 大宗公开, 大宗交易记录\n## 参数：\n##   - instId: 产品ID。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~5KB\n## 关联：本工具看大宗成交 → 分析大宗市场 → 评估机构动向",
    {
      instId: z.string().describe("产品ID。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getPublicBlockTrades(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_instrument_tick_bands",
    "## 功能：查询产品最小价格精度档位\n## 场景：用于了解期权产品的价格最小变动单位（tick size）\n## 关键词：Tick档位, tick bands, 最小价格变动, 价格精度\n## 参数：\n##   - instType: 产品类型。仅 OPTION 支持。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：此工具查精度 → okx_get_instruments 查产品规格 → 下单时使用正确价格",
    {
      instType: z.enum(["OPTION"]).describe("产品类型。仅 OPTION 支持此查询"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getInstrumentTickBands(instType)
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )
}
