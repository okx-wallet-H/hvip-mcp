import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { publicApi } from "../adapters/okx.js"
import { toResult, toError, INST_TYPE_MARKET } from "./shared.js"

export function registerMarketTools(server: McpServer): void {
  server.tool(
    "okx_get_ticker",
    "CAT:[行情] | ## 功能：获取单个或多个产品的实时行情Ticker，包含最新价、买一价、卖一价、24h成交量等\n## 场景：用于查看实时价格、批量监控行情、判断买卖价差、计算交易成本\n## 关键词：行情, 价格, ticker, 最新价, 买卖价, 24h涨跌, 实时价格\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT、ETH-USDT-SWAP。支持逗号分隔批量查询，如 BTC-USDT,ETH-USDT,SOL-USDT\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~1KB，批量 ~5KB — 微小\n## 关联：本工具（几乎所有查询的入口）→ 结合 okx_get_candles 分析走势 → okx_place_order 下单",
    { instId: z.string().describe("产品ID，如 BTC-USDT、ETH-USDT-SWAP。支持逗号分隔批量查询，如 BTC-USDT,ETH-USDT,SOL-USDT") },
    async ({ instId }) => {
      try {
        const ids = instId.split(",").map(s => s.trim()).filter(Boolean)
        const allData: any[] = []
        for (const id of ids) {
          const data = await publicApi.getTicker(id) as any[]
          const enriched = data.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          allData.push(...enriched)
        }
        return toResult(allData)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_tickers",
    "CAT:[行情] | ## 功能：获取某类产品的全量行情列表\n## 场景：用于批量扫描市场、寻找异常价格或高成交量品种、全市场概览\n## 关键词：全量行情, tickers, 批量价格, 市场扫描, 高成交量, 全市场\n## 参数：\n##   - instType: 产品类型。SPOT=现货, SWAP=永续, FUTURES=交割, OPTION=期权\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：全量 ~77KB（已自动截断 top 20，返回 {total, returned, data}）\n## 关联：本工具扫描市场 → okx_get_ticker 查单个详情 → 发现异常后深入分析",
    { instType: z.enum(INST_TYPE_MARKET).describe("产品类型") },
    async ({ instType }) => {
      try {
        const data = await publicApi.getTickers(instType)
        // 分页保护：全量数据可能很大（~77KB），截取 top 20 按交易量排序
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
    "okx_get_orderbook",
    "CAT:[行情] | ## 功能：获取产品的订单簿深度，含买卖双方挂单价格和数量\n## 场景：用于分析流动性、判断支撑/压力位、评估大单对市场的潜在冲击\n## 关键词：订单簿, 深度, orderbook, 买卖盘, 挂单, 流动性, 支撑压力\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - depth: 深度档位，默认20，最大400\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：单产品 ~5KB — 微小\n## 关联：先调 okx_get_instruments 获取可交易产品 → 本工具查深度 → 结合 okx_get_ticker 判断买卖力量",
    {
      instId: z.string().describe("产品ID"),
      depth: z.number().int().min(1).max(400).optional().describe("深度档位，默认20，最大400"),
    },
    async ({ instId, depth }) => {
      try {
        const data = await publicApi.getOrderbook(instId, depth)
        const enriched = (data as any).data || data
        if (Array.isArray(enriched)) {
          const withTsIso = enriched.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          return toResult(withTsIso)
        }
        if (enriched && typeof enriched === 'object') {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_candles",
    "CAT:[行情] | ## 功能：获取产品K线数据（OHLCV）\n## 场景：用于技术分析画图、判断趋势方向、计算技术指标（MA/RSI/MACD）、准备回测数据\n## 关键词：K线, candles, OHLCV, 技术分析, 趋势, K线图, 蜡烛图\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - bar: K线周期。1m/3m/5m/15m/30m=分钟, 1H=1小时, 4H=4小时, 1D=日线, 1W=周线。默认1H\n##   - limit: 返回条数，默认100，最大300\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB — 微小\n## 关联：本工具获取K线 → 技术分析后 → okx_place_order 下单",
    {
      instId: z.string().describe("产品ID"),
      bar: z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      limit: z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, limit }) => {
      try {
        const data = await publicApi.getCandles(instId, bar, limit)
        // 修复：数组转语义化对象 [ts,o,h,l,c,vol,volCcy] → {ts,tsIso,open,high,low,close,vol,volCcy}
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_trades",
    "CAT:[行情] | ## 功能：获取产品最新成交记录\n## 场景：用于分析短期买卖压力、判断主动买卖方向、跟踪大单动向\n## 关键词：成交记录, trades, 最新成交, 主动买卖, 成交明细, 成交价\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - limit: 返回条数，默认20，最大100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：20条 ~2KB — 微小\n## 关联：okx_get_ticker 看最新价 → 本工具看逐笔成交 → okx_get_candles 判断趋势",
    {
      instId: z.string().describe("产品ID"),
      limit: z.number().int().min(1).max(100).optional().describe("返回条数，默认20"),
    },
    async ({ instId, limit }) => {
      try {
        const data = await publicApi.getTrades(instId, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_history_candles",
    "CAT:[行情] | ## 功能：获取产品历史K线数据（最近3个月以前的数据）\n## 场景：用于回测策略、长周期技术分析、历史行情研究\n## 关键词：历史K线, history candles, 回测, 长周期, 历史行情, 历史数据\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - bar: K线周期。1m/3m/5m/15m/30m=分钟, 1H=1小时, 4H=4小时, 1D=日线, 1W=周线。默认1H\n##   - after: 查询此时间戳之前的数据（毫秒Unix时间戳，用于翻页）\n##   - before: 查询此时间戳之后的数据（毫秒Unix时间戳）\n##   - limit: 返回条数，默认100，最大100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB — 微小\n## 关联：okx_get_candles 获取最近数据 → 本工具获取更早数据 → 拼接完整时间序列回测",
    {
      instId:  z.string().describe("产品ID，如 BTC-USDT"),
      bar:     z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:   z.string().optional().describe("查询此时间戳之前的数据（毫秒Unix时间戳，用于翻页）"),
      before:  z.string().optional().describe("查询此时间戳之后的数据（毫秒Unix时间戳）"),
      limit:   z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryCandles(instId, bar, after, before, limit)
        // 修复：数组转语义化对象
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_history_trades",
    "CAT:[行情] | ## 功能：获取产品历史成交记录（最近3个月）\n## 场景：用于分析历史成交价格分布、研究流动性模式、复盘历史交易\n## 关键词：历史成交, history trades, 成交历史, 价格分布, 流动性研究\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT\n##   - limit: 返回条数，默认100，最大100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~10KB — 中等\n## 关联：okx_get_trades 查最新成交 → 本工具查历史成交 → 分析成交分布模式",
    {
      instId: z.string().describe("产品ID"),
      limit:  z.number().int().min(1).max(100).optional().describe("返回条数，默认100"),
    },
    async ({ instId, limit }) => {
      try {
        const data = await publicApi.getHistoryTrades(instId, limit)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_system_status",
    "CAT:[行情] | ## 功能：获取OKX系统维护状态\n## 场景：用于下单前确认系统正常运行中、避免维护期误操作、排查交易失败原因\n## 关键词：系统状态, system status, 维护, 运行状态, 平台状态\n## 参数：无\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~200B\n## 关联：本工具检查系统状态 → 正常则 okx_place_order 下单 → 异常则提示用户等待",
    {},
    async () => {
      try {
        const data = await publicApi.getSystemStatus()
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_block_tickers",
    "CAT:[行情] | ## 功能：获取大宗交易（Block Trading）实时行情\n## 场景：用于跟踪机构资金动向、判断大额成交价格、分析机构对当前价格的认可度\n## 关键词：大宗交易, block trading, 机构资金, 大额成交, 机构动向\n## 参数：\n##   - instType: 产品类型。SPOT=现货, SWAP=永续, FUTURES=交割, OPTION=期权\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB（已自动截断 top 20）\n## 关联：okx_get_ticker 看散户价格 → 本工具看机构价格 → 对比发现机构溢价/折价",
    {
      instType: z.enum(INST_TYPE_MARKET).describe("产品类型"),
    },
    async ({ instType }) => {
      try {
        const data = await publicApi.getBlockTickers(instType)
        // 分页保护：截取 top 20
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
    "okx_get_books_full",
    "CAT:[行情] | ## 功能：获取产品全深度订单簿（所有档位）\n## 场景：用于精确分析市场流动性全貌、发现隐藏的大额挂单、计算深度加权价格\n## 关键词：全深度, 完整订单簿, books full, 所有档位, 深度分析, 流动性全景\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT。必填\n##   - depth: 深度档位，默认全部，可选指定档位数\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用。⚠️ 数据量大（可达数百KB），慎重全量返回\n## 返回量：大型 ~200KB+（包含所有档位数据）\n## 关联：okx_get_orderbook 看有限深度 → 本工具看全深度 → 计算精确市场冲击成本",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT"),
      depth:  z.number().int().min(1).max(400).optional().describe("深度档位，默认全量，可选限制"),
    },
    async ({ instId, depth }) => {
      try {
        const data = await publicApi.getBooksFull(instId, depth)
        const enriched = (data as any).data || data
        if (Array.isArray(enriched)) {
          const withTsIso = enriched.map((item: any) => ({
            ...item,
            tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
          }))
          return toResult(withTsIso)
        }
        if (enriched && typeof enriched === 'object') {
          return toResult({
            ...enriched,
            tsIso: enriched.ts ? new Date(parseInt(enriched.ts)).toISOString() : undefined,
          })
        }
        return toResult(data)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_index_tickers",
    "CAT:[行情] | ## 功能：获取指数行情列表（多交易所加权均价）\n## 场景：用于查看指数现货价格基准、批量获取各币种指数价格、判断合约标记价偏差\n## 关键词：指数行情, index tickers, 指数价格, 加权均价, 现货基准\n## 参数：\n##   - quoteCcy: 计价币种，如 USDT、USD、BTC。不填返回全部\n##   - instId: 指定产品ID，如 BTC-USDT。可选\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：中等 ~10KB\n## 关联：本工具看指数价格 → okx_get_mark_price 看标记价 → 对比偏差判断套利空间",
    {
      quoteCcy: z.string().optional().describe("计价币种，如 USDT、USD、BTC"),
      instId:   z.string().optional().describe("产品ID，如 BTC-USDT"),
    },
    async ({ quoteCcy, instId }) => {
      try {
        const data = await publicApi.getIndexTickers(quoteCcy, instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_index_candles",
    "CAT:[行情] | ## 功能：获取指数K线数据（多交易所加权均价的OHLCV）\n## 场景：用于分析现货市场整体价格走势、排除单交易所异常波动、判断真实市场趋势\n## 关键词：指数K线, index candles, 指数OHLCV, 加权K线, 现货趋势\n## 参数：\n##   - instId: 指数产品ID，如 BTC-USDT。必填\n##   - bar: K线周期。1m/3m/5m/15m/30m=分钟, 1H=1小时, 4H=4小时, 1D=日线, 1W=周线。默认1H\n##   - after: 查询此时间戳之前的数据（毫秒Unix时间戳）\n##   - before: 查询此时间戳之后的数据（毫秒Unix时间戳）\n##   - limit: 返回条数，默认100，最大300\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB — 微小\n## 关联：okx_get_candles 看单交易所K线 → 本工具看指数K线 → 对比判断交易所偏差",
    {
      instId: z.string().describe("指数产品ID，如 BTC-USDT"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒Unix时间戳）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒Unix时间戳）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getIndexCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )


  // ── 市场数据补完（v0.2.26 新缺口） ────────────────────────────────────────

  server.tool(
    "okx_get_block_ticker",
    "CAT:[行情] | ## 功能：获取大宗交易单个产品实时行情\n## 场景：用于查询大宗市场的最新成交价、买卖报价\n## 关键词：大宗行情, block ticker, 大宗最新价, 大宗买卖价\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT。必填\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~500B\n## 关联：本工具查大宗行情 → okx_get_block_tickers 看全量大宗 → 评估大宗市场",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT。必填"),
    },
    async ({ instId }) => {
      try {
        const data = await publicApi.getBlockTicker(instId)
        const enriched = (data as any[]).map((item: any) => ({
          ...item,
          tsIso: item.ts ? new Date(parseInt(item.ts)).toISOString() : undefined,
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_history_index_candles",
    "CAT:[行情] | ## 功能：获取指数历史K线（3个月以前的数据）\n## 场景：用于长周期指数走势分析、策略回测\n## 关键词：指数历史K线, index history candles, 历史指数, 回测数据\n## 参数：\n##   - instId: 指数产品ID，如 BTC-USDT。必填\n##   - bar: K线周期。默认1H\n##   - after: 此时间戳之前的数据（毫秒）\n##   - before: 此时间戳之后的数据（毫秒）\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB\n## 关联：okx_get_index_candles 查近期 → 本工具查历史 → 长周期分析",
    {
      instId: z.string().describe("指数产品ID，如 BTC-USDT。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryIndexCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_history_mark_price_candles",
    "CAT:[行情] | ## 功能：获取标记价历史K线（3个月以前）\n## 场景：用于历史标记价走势回测、分析强平价格变化\n## 关键词：标记价历史K线, mark price history candles, 标记价回测\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - bar: K线周期。默认1H\n##   - after: 此时间戳之前的数据（毫秒）\n##   - before: 此时间戳之后的数据（毫秒）\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB\n## 关联：okx_get_mark_price_candles 查近期 → 本工具查历史 → 对比分析",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getHistoryMarkPriceCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_mark_price_candles",
    "CAT:[行情] | ## 功能：获取标记价K线数据\n## 场景：用于计算合约资金费率用的标记价走势、判断强平风险\n## 关键词：标记价K线, mark price candles, 标记价走势, 强平参考\n## 参数：\n##   - instId: 产品ID，如 BTC-USDT-SWAP。必填\n##   - bar: K线周期。默认1H\n##   - after: 此时间戳之前的数据（毫秒）\n##   - before: 此时间戳之后的数据（毫秒）\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB\n## 关联：okx_get_index_candles 看指数K线 → 本工具看标记价 → 对比基差",
    {
      instId: z.string().describe("产品ID，如 BTC-USDT-SWAP。必填"),
      bar:    z.enum(["1m","3m","5m","15m","30m","1H","4H","1D","1W"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ instId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getMarkPriceCandles(instId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )

  server.tool(
    "okx_get_sprd_history_candles",
    "CAT:[行情] | ## 功能：获取价差合约历史K线（3个月以前）\n## 场景：用于研究价差历史走势的长期趋势、计算跨期套利的季节性模式\n## 关键词：价差历史K线, sprd history candles, 价差回测, 跨期历史\n## 参数：\n##   - sprdId: 价差合约ID。必填\n##   - bar: K线周期。默认1H\n##   - after: 此时间戳之前的数据（毫秒）\n##   - before: 此时间戳之后的数据（毫秒）\n##   - limit: 返回条数，默认100\n## 鉴权：PUBLIC — 公开接口，不需要 API Key\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：100条 ~5KB\n## 关联：okx_get_spread_candles 查近期 → 本工具查历史 → 长周期套利分析",
    {
      sprdId: z.string().describe("价差合约ID。必填"),
      bar:    z.enum(["1m","5m","15m","30m","1H","4H","1D"]).optional().describe("K线周期，默认1H"),
      after:  z.string().optional().describe("查询此时间戳之前的数据（毫秒）"),
      before: z.string().optional().describe("查询此时间戳之后的数据（毫秒）"),
      limit:  z.number().int().min(1).max(300).optional().describe("返回条数，默认100"),
    },
    async ({ sprdId, bar, after, before, limit }) => {
      try {
        const data = await publicApi.getSpreadHistoryCandles(sprdId, bar, after, before, limit)
        const enriched = (data as any[][]).map((row: any[]) => ({
          ts:     row[0],
          tsIso:  row[0] ? new Date(parseInt(row[0])).toISOString() : undefined,
          open:   row[1],
          high:   row[2],
          low:    row[3],
          close:  row[4],
          vol:    row[5],
          volCcy: row[6],
        }))
        return toResult(enriched)
      } catch (e) { return toError(e) }
    }
  )
}
