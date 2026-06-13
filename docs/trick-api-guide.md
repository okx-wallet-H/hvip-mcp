# OKX 技巧常用 API 一览

> 来源：[OKX API v5 技巧页](https://www.okx.com/docs-v5/trick_zh/#instrument-configuration)
> 共 25 个端点，全部已接入 hvip-mcp-server

---

## 公开数据

| 工具 | 端点 | 鉴权 |
|:----|:-----|:----:|
| `okx_get_instruments` | `GET /api/v5/public/instruments` | PUBLIC |
| `okx_get_system_status` | `GET /api/v5/system/status` | PUBLIC |

## 账户配置

| 工具 | 端点 | 鉴权 |
|:----|:-----|:----:|
| `okx_get_account_config` | `GET /api/v5/account/config` | READ |
| `okx_get_leverage_info` | `GET /api/v5/account/leverage-info` | READ |
| `okx_set_leverage` | `POST /api/v5/account/set-leverage` | TRADE |
| `okx_set_position_mode` | `POST /api/v5/account/set-position-mode` | TRADE |
| `okx_set_greeks` | `POST /api/v5/account/set-greeks` | TRADE |

## 交易操作

| 工具 | 端点 | 鉴权 |
|:----|:-----|:----:|
| `okx_place_order` | `POST /api/v5/trade/order` | TRADE |
| `okx_batch_orders` | `POST /api/v5/trade/batch-orders` | TRADE |
| `okx_amend_order` | `POST /api/v5/trade/amend-order` | TRADE |
| `okx_amend_batch_orders` | `POST /api/v5/trade/amend-batch-orders` | TRADE |
| `okx_cancel_order` | `POST /api/v5/trade/cancel-order` | TRADE |
| `okx_batch_cancel_orders` | `POST /api/v5/trade/cancel-batch-orders` | TRADE |
| `okx_get_orders_pending` | `GET /api/v5/trade/orders-pending` | READ |
| `okx_get_orders_history` | `GET /api/v5/trade/orders-history` | READ |
| `okx_get_orders_history_archive` | `GET /api/v5/trade/orders-history-archive` | READ |
| `okx_get_fills` | `GET /api/v5/trade/fills` | READ |
| `okx_get_fills_history` | `GET /api/v5/trade/fills-history` | READ |

## 账户余额 / 持仓

| 工具 | 端点 | 鉴权 |
|:----|:-----|:----:|
| `okx_get_balance` | `GET /api/v5/account/balance` | READ |
| `okx_get_max_avail_size` | `GET /api/v5/account/max-avail-size` | READ |
| `okx_get_max_withdrawal` | `GET /api/v5/account/max-withdrawal` | READ |
| `okx_get_positions` | `GET /api/v5/account/positions` | READ |
| `okx_get_positions_history` | `GET /api/v5/account/positions-history` | READ |
| `okx_get_account_bills` | `GET /api/v5/account/bills` | READ |
| `okx_get_account_bills_archive` | `GET /api/v5/account/bills-archive` | READ |

---

> 这些是 OKX 官方挑选的**最常用 25 个端点**，覆盖了从配置→杠杆→交易→查询的完整交易流程。
