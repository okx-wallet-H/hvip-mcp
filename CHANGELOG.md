# Changelog

> **版本格式：** `v{major}.{minor}.{patch}`
> **更新频率：** 按功能合并节奏发布，非固定周期

---

## v0.2.42 — 2026-06-13

**📡 预测市场 WebSocket 实时频道（+4 工具，+16 频道）**

### 新增
- **技巧常用 API**：补齐 `set-greeks` + `max-avail-size` 2 个缺漏端点
- CLAUDE.md 导航新增 "🎯 技巧常用" 独立分类
- `docs/trick-api-guide.md` — 25 个常用端点完整参考
- **WS-01** 公共行情频道：`prediction-market-prices`、`pm-books`、`pm-trades`、`pm-tickers`、`pm-event-status`
- **WS-02** 私有频道：`pm-order`、`pm-position`、`pm-user-trade`、`pm-balance`、`pm-pnl`
- **WS-03** K 线频道：`pm-candle1m/5m/15m/1H/4H/1D`
- 自动重连（3 次指数退避）
- EIP-712 签名 login 鉴权
- 事件内存缓冲区 + 断线恢复订阅

### 工具数
352 个（+10）

---

## v0.2.40 — 2026-06-12

**🔮 预测市场全部 REST API 对接完成（+26 工具）**

### 新增
- **T-001** Outcomes 事件市场查询 — 5 个端点（events/search/event/event-markets/market）
- **T-002** Outcomes 市场数据 — 3 个端点（ticker/candles/pm-books）
- **T-003** Outcomes 订单管理（EIP-712）— 6 个端点（place/cancel/cancel-all/heartbeat/get-order/order-list）
- **T-004** Outcomes 持仓 & 账户 — 6 个端点（positions/split/merge/redeem/balance/trades）
- **T-005** 事件合约交易 — 5 个端点（place/cancel/amend/fills/instruments）
- **T-006** H Rails 市场列表 — 1 个端点
- Agent Hub 共享会议室 — 审核员实时反馈
- WebSocket 实时事件管道 — 4 个工具（subscribe/unsubscribe/events/status）

### 规范
- 全部使用 `getAuth()` 内部获取认证（不改函数签名）
- 统一加 `tsIso` 时间戳
- 8 字段中文描述模板
- `toResult()` / `toError()` 错误处理

### 工具数
342 个（+26）

---

## v0.2.38 — 2026-06-12

**🧠 Agent 协作基础设施**

### 新增
- Agent Hub WS 连接协议（`ws://localhost:9321`）
- `agent:hello` / `task:dispatch` / `task:claim` / `task:done` 消息机制
- 每 60 秒心跳保活
- 任务池 README 含 6 个 T-001 ~ T-006 预测市场任务
- 反馈留言板 MCP 工具 `okx_agent_feedback`

### 工具数
316 个

---

## v0.2.35 — 2026-06-12

**🛠️ 描述升级 + 规范统一**

### 变更
- `algo.ts` / `trading.ts` / `public.ts` 三文件描述升级到 8 字段模板
- 添加 CLAUDE.md / AGENTS.md 项目指南
- 添加 SKILL_FEEDBACK.md 反馈机制
- 统一错误格式 `errorCategory`

### 工具数
304 个

---

## v0.2.34 — 2026-06-11

**🚀 初始版本**

### 核心功能
- OKX REST API 全模块覆盖（19 个模块）
- 301 个原子工具 + 3 个组合 Skill
- 覆盖 97.7% OKX REST API
- HMAC-SHA256 本地签名（API Key 不出机器）
- 8 字段中文描述模板

### 模块
| 模块 | 工具数 |
|:----|:-----:|
| account | 40 |
| trading | 29 |
| stats | 25 |
| copy | 23 |
| market | 18 |
| funding | 19 |
| spread | 17 |
| subaccount | 14 |
| rfq | 12 |
| signal | 10 |
| outcomes | 10 |
| public | 33 |
| finance | 27 |
| bot | 13 |
| algo | 7 |
| affiliate | 6 |
| fiat | 4 |

### Skill 组合层
- `okx_account_overview` — 全景快照
- `okx_quick_market` — 行情速查
- `okx_preflight_check` — 下单预检
