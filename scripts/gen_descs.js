const fs = require('fs');
const path = require('path');

function genDesc(toolName, domain) {
  const parts = toolName.split('_');
  const resource = parts.slice(1).join(' ');

  if (toolName.includes('balance')) return `[D:${domain}] 账户余额查询 | ccy?不填全部 | 估值用 account_valuation → 持仓用 account_positions`;
  if (toolName.includes('positions_history')) return `[D:${domain}] 历史持仓记录 | instType? | 当前用 account_positions`;
  if (toolName.includes('positions_move')) return `[D:${domain}] 迁移持仓(账户间) | instId, from, to | 需确认`;
  if (toolName.includes('positions')) return `[D:${domain}] 当前持仓(含强平价/保证金率) | instType?, instId? | 全景用 account_overview`;
  if (toolName.includes('overview')) return `[D:${domain}] 账户全景快照：余额+持仓+配置+估值 | 无需参数 | 深入用 account_balance`;
  if (toolName.includes('config')) return `[D:${domain}] 账户配置查询 | 无需参数 | 修改用 account_mode_set`;
  if (toolName.includes('leverage_set')) return `[D:${domain}] 设置杠杆倍数 | instId, lever | 需确认 → 当前用 account_leverage`;
  if (toolName.includes('leverage')) return `[D:${domain}] 当前杠杆倍数查询 | instId | 设置用 account_leverage_set`;
  if (toolName.includes('bills_archive')) return `[D:${domain}] 账单归档(历史) | instType?, ccy? | 近期用 account_bills`;
  if (toolName.includes('bills')) return `[D:${domain}] 账单流水 | instType?, ccy? | 归档用 account_bills_archive`;
  if (toolName.includes('fee_rates') || toolName.includes('trade_fee')) return `[D:${domain}] 手续费率查询 | instType?, instId? | 下单前参考`;
  if (toolName.includes('valuation')) return `[D:${domain}] 总资产估值 | 无需参数 | 配合 account_balance`;
  if (toolName.includes('margin_balance')) return `[D:${domain}] 杠杆账户保证金详情 | instType? | 风控用 risk_overview`;
  if (toolName.includes('max_size') || toolName.includes('max_loan') || toolName.includes('max_withdrawal')) return `[D:${domain}] 最大可开/可借/可提查询 | instId, tdMode | 下单前参考`;
  if (toolName.includes('mode_set')) return `[D:${domain}] 设置账户层级模式 | acctLv | ADMIN操作`;
  if (toolName.includes('position_mode_set')) return `[D:${domain}] 设置持仓模式(单向/双向) | posMode | ADMIN操作`;
  if (toolName.includes('settle_currency_set')) return `[D:${domain}] 设置结算币种 | ccy | ADMIN操作`;
  if (toolName.includes('interest')) return `[D:${domain}] 利息/借币限额查询 | ccy?, type? | 借币前查`;
  if (toolName.includes('borrow_repay')) return `[D:${domain}] 借币/还款操作 | ccy, sz, side | 需确认`;
  if (toolName.includes('convert_trade') || toolName.includes('easy_convert')) return `[D:${domain}] 闪兑交易 | instId, sz, side | 需确认`;
  if (toolName.includes('convert_currencies')) return `[D:${domain}] 闪兑支持币种列表 | 无需参数 | 兑换前查`;
  if (toolName.includes('greeks')) return `[D:${domain}] 账户Greeks(Delta/Gamma/Theta/Vega) | 无需参数 | 期权风控`;
  if (toolName.includes('position_risk')) return `[D:${domain}] 持仓风险详情(保证金率/强平价) | instType? | 全景用 risk_overview`;
  if (toolName.includes('subaccount') || toolName.includes('sub_account') || toolName.includes('sub_key')) return `[D:${domain}] 子账户管理 | 相关子账户操作`;
  if (toolName.includes('auto_loan') || toolName.includes('auto_earn')) return `[D:${domain}] 自动借币/理财设置 | 需确认`;
  if (toolName.includes('preset')) return `[D:${domain}] 预设账户切换 | 参数见schema | 需确认`;
  if (toolName.includes('activate')) return `[D:${domain}] 激活期权交易 | 需确认`;
  if (toolName.includes('position_builder')) return `[D:${domain}] 仓位构建器试算 | instType?, instId? | 模拟用 sim_order`;
  if (toolName.includes('delta_neutral')) return `[D:${domain}] Delta中性预检 | 参数见schema`;
  if (toolName.includes('risk_state')) return `[D:${domain}] 账户风控状态查询 | 无需参数 | 全景用 risk_overview`;
  if (toolName.includes('trading_config')) return `[D:${domain}] 交易配置设置 | 需确认`;

  // Trading
  if (toolName === 'trade_place') return `[D:Trading] 下单(限价/市价) | instId, side, sz, tdMode, px?, ordType? | 需确认 → 先模拟 sim_order`;
  if (toolName === 'trade_cancel') return `[D:Trading] 撤单 | ordId或clOrdId | 批量用 trade_cancel_batch`;
  if (toolName === 'trade_amend') return `[D:Trading] 改单(价格/数量) | ordId, newPx?, newSz? | 不可改方向`;
  if (toolName === 'trade_orders_active') return `[D:Trading] 当前挂单列表 | instType?, instId? | 历史用 trade_orders_history`;
  if (toolName === 'trade_order') return `[D:Trading] 查询单个订单 | ordId或clOrdId | 成交用 trade_fills`;
  if (toolName === 'trade_fills') return `[D:Trading] 成交明细 | instType?, ordId? | 历史用 trade_fills_history`;
  if (toolName === 'trade_close') return `[D:Trading] 平仓 | instId, posSide?, sz? | 需确认 → 全平不填sz`;
  if (toolName === 'trade_place_batch') return `[D:Trading] 批量下单(最多20笔) | 订单数组 | 需确认`;
  if (toolName === 'trade_cancel_batch') return `[D:Trading] 批量撤单 | ordId数组`;
  if (toolName === 'trade_cancel_all') return `[D:Trading] 按产品类型批量撤单 | instType`;
  if (toolName === 'trade_cancel_all_after') return `[D:Trading] 定时全撤(倒计时) | instType, timeout(秒)`;
  if (toolName === 'trade_preflight') return `[D:Trading] 下单预检(参数合法性) | instId, side, sz, tdMode | 先预检→模拟→下单`;

  // Strategy (grid/copy/signal/rfq/spread)
  if (toolName.includes('grid_create')) return `[D:Strategy] 创建网格策略 | instId, algoOrdType, sz, pxRange | 需确认 → AI参数用 strategy_grid_ai_params`;
  if (toolName.includes('grid_stop')) return `[D:Strategy] 停止网格策略 | algoId, instId | 需确认`;
  if (toolName.includes('grid_close')) return `[D:Strategy] 平网格仓位 | algoId, instId | 需确认`;
  if (toolName.includes('grid_positions')) return `[D:Strategy] 网格持仓查询 | algoId?, instType?`;
  if (toolName.includes('grid_ai_params')) return `[D:Strategy] AI推荐网格参数 | instType, algoOrdType | hvip独有 → 一键创建 strategy_grid_create`;
  if (toolName.includes('grid_orders_active')) return `[D:Strategy] 当前活跃网格策略 | algoOrdType? | 历史用 strategy_grid_orders_history`;
  if (toolName.includes('grid_sub')) return `[D:Strategy] 网格子订单查询 | algoId, instId`;

  if (toolName.includes('copy_start')) return `[D:Strategy] 开始跟单 | uniqueName, instType, sz | 需确认 → 先搜 agent_copy_trader_search`;
  if (toolName.includes('copy_stop')) return `[D:Strategy] 停止跟单 | uniqueName?, instType? | 需确认`;
  if (toolName.includes('copy_lead')) return `[D:Strategy] 带单员持仓/历史/统计 | uniqueName?, instType?`;
  if (toolName.includes('copy_settings')) return `[D:Strategy] 跟单设置查询/修改 | uniqueName?, instType?`;
  if (toolName.includes('copy_profit')) return `[D:Strategy] 分润查询 | uniqueName?, instType?`;
  if (toolName.includes('copy_my')) return `[D:Strategy] 我的跟单持仓/历史 | instType?`;
  if (toolName.includes('copy_traders')) return `[D:Strategy] 我关注的跟单交易员列表 | instType?`;
  if (toolName.includes('copy_instruments')) return `[D:Strategy] 跟单支持的产品列表 | 无需参数`;
  if (toolName.includes('copy_leaders')) return `[D:Strategy] 公开带单员列表 | instType?, sortBy?`;
  if (toolName.includes('copy_leader_pnl')) return `[D:Strategy] 带单员收益查询 | uniqueName`;
  if (toolName.includes('copy_config')) return `[D:Strategy] 公开跟单配置 | uniqueName`;
  if (toolName.includes('copy_currency')) return `[D:Strategy] 跟单偏好币种查询 | uniqueName`;
  if (toolName.includes('copy_search')) return `[D:Strategy] 智能跟单搜索(收益/胜率/回撤) | sortBy, topN | hvip独有`;

  if (toolName.includes('signal_bot_create')) return `[D:Strategy] 创建信号机器人 | instId, signalId, sz | 需确认`;
  if (toolName.includes('signal_bot_stop')) return `[D:Strategy] 停止信号机器人 | algoId | 需确认`;
  if (toolName.includes('signal_bots_active')) return `[D:Strategy] 当前活跃信号机器人 | algoOrdType?`;
  if (toolName.includes('signal_positions')) return `[D:Strategy] 信号持仓查询 | algoId?`;
  if (toolName.includes('signal_sub')) return `[D:Strategy] 信号子订单查询 | algoId`;

  if (toolName.includes('recurring_create')) return `[D:Strategy] 创建定投计划 | instId, sz, period | 需确认`;
  if (toolName.includes('recurring_stop')) return `[D:Strategy] 停止定投计划 | algoId | 需确认`;
  if (toolName.includes('recurring_orders_active')) return `[D:Strategy] 当前定投计划 | algoOrdType?`;
  if (toolName.includes('recurring_sub')) return `[D:Strategy] 定投子订单 | algoId`;

  if (toolName.includes('algo_place')) return `[D:Strategy] 策略委托下单(止损/止盈/冰山/TWAP) | instId, tdMode, side, sz, ordType, algoType | 需确认`;
  if (toolName.includes('algo_cancel')) return `[D:Strategy] 撤销策略委托 | algoId, instId | 需确认`;
  if (toolName.includes('algo_amend')) return `[D:Strategy] 修改策略委托 | algoId, instId, newPx?, newSz? | 需确认`;
  if (toolName.includes('algo_orders')) return `[D:Strategy] 策略委托列表 | algoOrdType? | 活跃用 strategy_algo_orders_active`;

  // Funds
  if (toolName.includes('fund_transfer')) return `[D:Funds] 资金划转 | from, to, ccy, sz | 需确认 → 状态用 fund_transfer_state`;
  if (toolName.includes('fund_withdraw')) return `[D:Funds] 提币 | ccy, sz, addr, chain | 需确认`;
  if (toolName.includes('fund_deposit')) return `[D:Funds] 充值地址/记录查询 | ccy, chain?`;
  if (toolName.includes('fund_balance')) return `[D:Funds] 资金账户余额 | ccy? | 交易账户用 account_balance`;
  if (toolName.includes('fund_currencies')) return `[D:Funds] 链上币种信息列表 | 无需参数`;
  if (toolName.includes('eth_stake') || toolName.includes('eth_unstake')) return `[D:Funds] ETH质押操作 | sz | 需确认`;
  if (toolName.includes('sol_staking')) return `[D:Funds] SOL质押操作 | sz | 需确认`;
  if (toolName.includes('savings')) return `[D:Funds] 储蓄申购/赎回 | ccy, sz | 需确认`;
  if (toolName.includes('staking')) return `[D:Funds] 质押产品/订单查询 | ccy?, instType?`;
  if (toolName.includes('stable_rewards')) return `[D:Funds] 稳定币理财 | 参考收益`;
  if (toolName.includes('lending')) return `[D:Funds] 出借利率 | 理财参考`;
  if (toolName.includes('flexible_loan')) return `[D:Funds] 灵活借贷信息 | 借贷操作参考`;
  if (toolName.includes('collateral')) return `[D:Funds] 抵押品调整 | ccy, sz, action | 需确认`;
  if (toolName.includes('sfp')) return `[D:Funds] SFP理财 | 申购/赎回/历史`;
  if (toolName.includes('fiat')) return `[D:Funds] 法币入金 | ccy, side | 需确认`;
  if (toolName.includes('convert')) return `[D:Funds] 闪兑操作 | fromCcy, toCcy, sz | 需确认`;
  if (toolName.includes('monthly_statement')) return `[D:Funds] 月账单查询 | month | 对账用`;
  if (toolName.includes('asset_balances')) return `[D:Funds] 资产余额(全账户) | ccy?`;

  // Spread
  if (toolName.includes('spread')) return `[D:Trading] 价差合约操作 | instId?, instType? | 价差交易`;

  // RFQ
  if (toolName.includes('rfq')) return `[D:Trading] 大宗询价RFQ操作 | instId, sz, side | 需确认 → 大宗交易`;

  // Stats/Market
  if (toolName.includes('long_short_ratio')) return `[D:Market] 多空比数据 | instId?, period? | 市场情绪参考 → scan_sentiment`;
  if (toolName.includes('taker_volume')) return `[D:Market] 主动买卖成交量 | instId?, period? | 多空力量对比`;
  if (toolName.includes('open_interest')) return `[D:Market] 持仓量数据 | instId?, period? | 配合资金费率看多空`;
  if (toolName.includes('put_call_ratio')) return `[D:Market] 期权看跌看涨比(PCR) | instId?, period? | 市场恐慌指标`;
  if (toolName.includes('margin_lending_ratio')) return `[D:Market] 借贷比例数据 | instId?, period?`;
  if (toolName.includes('lending_rate')) return `[D:Market] 借出利率 | ccy? | 理财参考`;
  if (toolName.includes('stats_coins')) return `[D:Market] 交易大数据支持币种 | 无需参数`;
  if (toolName.includes('savings_lending_rate')) return `[D:Market] 储蓄出借利率 | ccy?`;
  if (toolName.includes('option_oi')) return `[D:Market] 期权持仓量分布(到期/行权价) | instType?, uly?`;
  if (toolName.includes('option_taker_block')) return `[D:Market] 期权大宗成交量 | uly?`;

  // Prediction
  if (toolName.includes('predict_event_place')) return `[D:Prediction] 事件合约下单 | instId, side, sz | 需确认`;
  if (toolName.includes('predict_event_cancel')) return `[D:Prediction] 事件合约撤单 | ordId | 需确认`;
  if (toolName.includes('predict_event_fills')) return `[D:Prediction] 事件合约成交查询 | instId?`;
  if (toolName.includes('predict_event_instruments')) return `[D:Prediction] 事件合约产品列表 | eventType? | 预测市场入口`;
  if (toolName.includes('predict_event_series')) return `[D:Prediction] 事件合约系列查询 | eventType?`;
  if (toolName.includes('predict_event_market')) return `[D:Prediction] 事件市场查询 | eventId?`;
  if (toolName.includes('predict_event_list')) return `[D:Prediction] 事件列表 | eventType?`;
  if (toolName.includes('predict_events')) return `[D:Prediction] 预测市场事件列表 | eventType? | 公开查询`;
  if (toolName.includes('predict_events_search')) return `[D:Prediction] 搜索预测事件 | keyword | 公开查询`;
  if (toolName.includes('predict_event_markets')) return `[D:Prediction] 事件下的市场列表 | eventId | 公开查询`;
  if (toolName.includes('predict_market_event')) return `[D:Prediction] 预测市场事件查询 | eventId`;
  if (toolName.includes('predict_market_detail')) return `[D:Prediction] 预测市场详情 | marketId?`;
  if (toolName.includes('predict_market_ticker')) return `[D:Prediction] 预测资产行情 | marketId? | 公开查询`;
  if (toolName.includes('predict_market_orderbook')) return `[D:Prediction] 预测资产深度 | marketId?`;
  if (toolName.includes('predict_market_candles')) return `[D:Prediction] 预测资产K线 | marketId, bar?`;
  if (toolName.includes('predict_market_arbitrage')) return `[D:Prediction] 预测市场套利扫描(YES+NO<1.0) | 无需参数 | hvip独有`;
  if (toolName.includes('predict_market_list')) return `[D:Prediction] 预测市场列表 | 公开查询`;
  if (toolName.includes('predict_place')) return `[D:Prediction] 预测市场下单 | marketId, side, sz | 需确认`;
  if (toolName.includes('predict_cancel')) return `[D:Prediction] 预测市场撤单 | ordId | 需确认`;
  if (toolName.includes('predict_cancel_all')) return `[D:Prediction] 预测市场全部撤单 | marketId? | 需确认`;
  if (toolName.includes('predict_ticker')) return `[D:Prediction] 预测资产行情 | instId? | 公开查询`;
  if (toolName.includes('predict_orderbook')) return `[D:Prediction] 预测资产深度 | instId`;
  if (toolName.includes('predict_candles')) return `[D:Prediction] 预测资产K线 | instId, bar?`;
  if (toolName.includes('predict_positions')) return `[D:Prediction] 预测市场持仓 | 需Key`;
  if (toolName.includes('predict_orders')) return `[D:Prediction] 预测市场订单列表 | 需Key`;
  if (toolName.includes('predict_order')) return `[D:Prediction] 预测订单查询 | ordId | 需Key`;
  if (toolName.includes('predict_split')) return `[D:Prediction] 拆分预测代币 | marketId, sz | 需Key`;
  if (toolName.includes('predict_merge')) return `[D:Prediction] 合并预测代币 | marketId, sz | 需Key`;
  if (toolName.includes('predict_redeem')) return `[D:Prediction] 赎回预测代币 | marketId, sz | 需Key`;
  if (toolName.includes('predict_balance')) return `[D:Prediction] 预测账户余额 | ccy? | 需Key`;
  if (toolName.includes('predict_trades')) return `[D:Prediction] 预测历史成交 | marketId? | 需Key`;
  if (toolName.includes('predict_heartbeat')) return `[D:Prediction] 预测市场心跳 | 公开查询`;

  // Indicators
  if (toolName === 'indicator_calc') return `[D:Indicators] 单指标计算+AI信号解读(超买/超卖/金叉/死叉) | instId, indicator(rsi/macd/bb等17种), bar? | hvip独有 → 批量用 indicator_batch`;
  if (toolName === 'indicator_batch') return `[D:Indicators] 多指标批量+综合信号(S/A/B/C四级) | instId, bar? | hvip独有VBT信号引擎 → 配合 agent_technical_report`;

  // WebSocket
  if (toolName === 'ws_subscribe') return `[D:WebSocket] 订阅公开WS频道(33个) | instId, channel | 55个频道实时推送`;
  if (toolName === 'ws_subscribe_private') return `[D:WebSocket] 订阅私有WS频道(账户/持仓/订单) | channel | 需Key`;
  if (toolName === 'ws_events') return `[D:WebSocket] 拉取WS缓存事件 | 无需参数`;
  if (toolName === 'ws_status') return `[D:WebSocket] 查看WS订阅状态 | 无需参数`;
  if (toolName === 'ws_close') return `[D:WebSocket] 关闭WS连接 | 无需参数`;
  if (toolName.includes('ws_xlayer')) return `[D:WebSocket] X Layer链上操作 | 参数见schema | 链上交互`;

  // System
  if (toolName.includes('affiliate')) return `[D:System] 推广数据查询 | 推广相关`;
  if (toolName.startsWith('sys_hub')) return `[D:System] Agent Hub集群管理 | 参数见schema`;
  if (toolName.startsWith('sys_room')) return `[D:System] Agent房间消息 | 参数见schema | Agent间协作`;

  // Code
  if (toolName === 'code_status') return `[D:CodeIntel] 代码知识图谱状态(节点/边/文件) | 无需参数 | → code_query 追踪调用链`;
  if (toolName === 'code_query') return `[D:CodeIntel] 代码图谱查询(callers/callees/search) | mode, symbol | 理解代码结构`;

  // Generic fallback
  const label = {Account:'账户',Trading:'交易',Funds:'资金',Strategy:'策略',Market:'行情',Prediction:'预测',WebSocket:'实时',System:'系统',CodeIntel:'代码',Indicators:'指标',SmartMoney:'聪明钱',Scan:'扫描',Risk:'风控',PnL:'盈亏',Simulate:'模拟'}[domain]||domain;
  return `[D:${domain}] ${label}：${resource} | 参数见schema`;
}

// Process all files
const toolsDir = 'src/tools';
const skipFiles = new Set(['agent-utils.ts', 'public.ts', 'market.ts', 'smartmoney.ts', 'ws.ts', 'xlayer-ws.ts', 'codegraph.ts', 'agent-hub.ts', 'agent-catalog-data.ts', 'agent-domain-details.ts', 'shared.ts', 'tool-name-map.json']);
const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts') && !skipFiles.has(f));

const fileDomain = {
  'account.ts': 'Account', 'trading.ts': 'Trading', 'algo.ts': 'Strategy',
  'funding.ts': 'Funds', 'fiat.ts': 'Funds', 'finance.ts': 'Funds',
  'bot.ts': 'Strategy', 'copy.ts': 'Strategy', 'signal.ts': 'Strategy',
  'spread.ts': 'Trading', 'rfq.ts': 'Trading', 'subaccount.ts': 'Account',
  'affiliate.ts': 'System', 'stats.ts': 'Market', 'outcomes.ts': 'Prediction',
  'indicators.ts': 'Indicators',
};

let totalFixed = 0;

for (const file of files) {
  const filepath = path.join(toolsDir, file);
  let content = fs.readFileSync(filepath, 'utf8');
  const domain = fileDomain[file] || 'System';
  let count = 0;

  // Replace generic "[D:Domain] english text" patterns
  content = content.replace(/"\[D:([A-Z][a-z]*)\] ([a-z][a-z_ ]*[a-z])"/g, (match, d, desc) => {
    const idx = content.indexOf(match);
    const before = content.slice(Math.max(0, idx - 300), idx);
    const nameMatch = before.match(/"([a-z_]{3,50})",\s*"(?:READ|WRITE|FUND_TRANSFER|ADMIN)"/);
    if (!nameMatch) return match;
    const toolName = nameMatch[1];
    const newDesc = genDesc(toolName, domain);
    count++;
    return '"' + newDesc + '"';
  });

  if (count > 0) {
    fs.writeFileSync(filepath, content);
    console.log(file + ': ' + count + ' fixed');
    totalFixed += count;
  }
}

console.log('\nTotal fixed: ' + totalFixed);
