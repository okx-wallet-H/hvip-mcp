# OKX 预测市场 API 全集（官方文档对照）

> 整理时间：2026-06-13 · 来源：https://www.okx.com/docs-v5/

OKX 预测市场有 **两套 API 体系**：

---

## 一、事件合约（Event Contract）— OKX 主站

Base：`https://www.okx.com` · 鉴权：标准 OKX API Key（与现货/合约共用）

### 公共数据

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 1 | `/api/v5/public/event-contract/series` | GET | 事件合约系列列表 | ✅ `okx_get_event_series` |
| 2 | `/api/v5/public/event-contract/events` | GET | 指定系列下的事件列表 | ✅ `okx_get_event_events` |
| 3 | `/api/v5/public/event-contract/markets` | GET | 指定系列下的市场 | ✅ `okx_get_event_markets` |

### 市场数据（复用现有端点，传 `instType=EVENTS`）

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 4 | `/api/v5/market/ticker?instId=...` | GET | 事件合约行情 | ❌ |
| 5 | `/api/v5/market/candles?instId=...` | GET | 事件合约 K 线 | ❌ |
| 6 | `/api/v5/market/books?instId=...` | GET | 事件合约深度 | ❌ |

### 交易（复用现有端点，加 `outcome=yes/no` + `speedBump=1`）

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 7 | `/api/v5/trade/order` | POST | 下单（需传 outcome + speedBump） | ❌ |
| 8 | `/api/v5/trade/cancel-order` | POST | 撤单 | ❌ |
| 9 | `/api/v5/trade/amend-order` | POST | 改单 | ❌ |
| 10 | `/api/v5/trade/orders-pending` | GET | 挂单查询 | ❌ |
| 11 | `/api/v5/trade/fills` | GET | 成交记录 | ❌ |

### 账户（复用现有端点）

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 12 | `/api/v5/account/instruments?instType=EVENTS` | GET | 事件合约可交易产品 | ❌ |
| 13 | `/api/v5/account/positions` | GET | 事件合约持仓 | ❌ |

### WebSocket

| # | 频道 | 类型 | 说明 | 已接 |
|---|------|------|------|:---:|
| 14 | `event-contract-markets` | 公共 | 事件合约实时行情 | ❌ |
| 15 | 私有成交频道 | 私有 | instType=EVENTS 的成交推送 | ❌ |

---

## 二、Outcomes 预测市场（独立平台）

Base：`https://www.okx.com` · 鉴权：OKX API Key **+ EIP-712 签名**（需 Agent 私钥）

### 事件 & 市场

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 1 | `/api/v5/predictions/events` | GET | 事件列表（分页/筛选） | ❌ |
| 2 | `/api/v5/predictions/events/search` | GET | 全文搜索事件 | ❌ |
| 3 | `/api/v5/predictions/events/{eventId}` | GET | 事件详情（含所有市场） | ❌ |
| 4 | `/api/v5/predictions/events/{eventId}/markets` | GET | 事件下所有市场 | ❌ |
| 5 | `/api/v5/predictions/markets/{marketId}` | GET | 单个市场详情 | ❌ |

### 市场数据（用 `yesAssetId` 作 instId）

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 6 | `/api/v5/market/ticker?instId={yesAssetId}` | GET | 行情 | ❌ |
| 7 | `/api/v5/market/candles?instId={yesAssetId}` | GET | K 线 | ❌ |
| 8 | `/api/v5/market/pm-books?instId={yesAssetId}&sz=400` | GET | 深度（最多 400 档） | ❌ |

### 订单

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 9 | `/api/v5/predictions/orders` | POST | 下单（EIP-712 签名） | ❌ |
| 10 | `/api/v5/predictions/orders/cancel` | POST | 撤单 | ❌ |
| 11 | `/api/v5/predictions/orders/cancel-all` | POST | 全部撤单 | ❌ |
| 12 | `/api/v5/predictions/heartbeat` | POST | 心跳保活（防断线） | ❌ |
| 13 | `/api/v5/predictions/orders/{orderId}` | GET | 订单详情 | ❌ |
| 14 | `/api/v5/predictions/orders` | GET | 订单列表（分页/筛选） | ❌ |

### 持仓

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 15 | `/api/v5/predictions/positions` | GET | 持仓查询（开/平/按市场） | ❌ |
| 16 | `/api/v5/predictions/positions/split` | POST | 拆分：xp → YES + NO | ❌ |
| 17 | `/api/v5/predictions/positions/merge` | POST | 合并：YES + NO → xp | ❌ |
| 18 | `/api/v5/predictions/positions/redeem` | POST | 赎回：获胜代币 → xp | ❌ |

### 账户

| # | 端点 | 方法 | 说明 | 已接 |
|---|------|------|------|:---:|
| 19 | `/api/v5/predictions/balance` | GET | xp 余额（总额/可用） | ❌ |
| 20 | `/api/v5/predictions/trades` | GET | 成交记录（分页/筛选） | ❌ |

---

## 三、现状汇总

| 体系 | 总端点数 | 已接 | 缺口 |
|------|:--:|:--:|:--:|
| 事件合约 (event-contract) | 15 | 3 | 12 |
| Outcomes (predictions) | 20 | 0 | 20 |
| H Rails (staging) | 8 | 7 | 1 |
| **合计** | **43** | **10** | **33** |

---

## 四、当前已有工具（10 个）

### H Rails API（7 个）
- `outcomes_list_events` — 事件列表
- `outcomes_get_event` — 事件详情
- `outcomes_get_market` — 市场详情
- `outcomes_get_ticker` — YES/NO 报价
- `outcomes_get_orderbook` — 深度
- `outcomes_get_candles` — K 线
- `outcomes_check_arbitrage` — 套利检测

### OKX 事件合约（3 个）
- `okx_get_event_series` — 系列列表
- `okx_get_event_markets` — 市场列表
- `okx_get_event_events` — 事件列表
