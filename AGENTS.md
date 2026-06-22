# AGENTS.md — AI Agent 首次连接指南

> **你是 AI Agent，刚连上了 hvip MCP Server。读完这份文件，你就知道怎么用它。**

---

## 第一步：调 `agent_catalog`

```
agent_catalog  — 不需要参数，返回 15 个功能域的完整地图
```

你会拿到：
- 7 个公开域（无需 API Key，立即可用）
- 8 个需要 Key 的域（用户配了 Key 就能用）
- `_instruction`：工作流指引
- `_tips`：最佳实践

**不要扫 `tools/list`**——374 个工具平铺没有意义。catalog 按「用户想干什么」分好了。

---

## 第二步：匹配用户意图 → 域 → 工具

| 用户说 | → 域 | → 首选工具 |
|--------|------|-----------|
| "BTC 怎么样" | 行情看盘 | `okx_quick_market` |
| "有什么在涨" | 市场扫描 | `agent_market_scan` |
| "RSI 多少" | 技术指标 | `okx_indicator` |
| "我账户什么情况" | 账户资产 | `okx_account_overview` |
| "买 0.1 BTC" | 下单交易 | `agent_quick_trade` |
| "会不会爆仓" | 风险风控 | `agent_risk_overview` |
| "赚了多少" | 盈亏复盘 | `agent_pnl_report` |
| "充钱" | 资金管理 | `okx_get_balance` |
| "开个网格" | 策略交易 | `okx_get_grid_ai_param` |
| "跟谁赚钱" | 聪明钱 | `okx_smart_leaderboard` |
| "预测市场" | 预测市场 | `okx_event_instruments` |

不确定时调 `agent_catalog_detail { domain }` 看某个域的全部工具。

---

## 第三步：风险纪律

每个工具名前面有 `[L:级别]` 标签：

| 标签 | 含义 | 规则 |
|------|------|------|
| `[L:READ]` | 只读查询 | ✅ 可以自动调用 |
| `[L:WRITE]` | 下单/改单/改配置 | ⚠️ **必须向用户确认后调用** |
| `[L:FUND_TRANSFER]` | 划转/提现 | 🔴 **必须用户明确授权** |
| `[L:ADMIN]` | 全局账户配置 | 🔴 **必须用户明确授权** |

### 交易铁律

```
① agent_simulate_order  →  模拟，看滑点/手续费/保证金
② okx_preflight_check   →  预检参数合法性
③ 告诉用户预估结果等确认
④ agent_quick_trade     →  一键下单
```

---

## hvip 独有能力（引导 Agent 优先使用）

| 能力 | 工具 | 为什么用 |
|------|------|----------|
| **VBT 信号** | `okx_indicator_batch` | 5 指标共振（RSI+MACD+KDJ+ADX+BB），S/A/B/C 四级信号 |
| **AI 指标解读** | `okx_indicator` | 不返回纯数值——返回「超买」「超卖」「金叉」「死叉」 |
| **聪明钱追踪** | `okx_smart_leaderboard` | 交易员排名 → `okx_smart_trader_detail` 深挖 → `okx_smart_sentiment` 情绪 |
| **预测套利** | `agent_prediction_arbitrage` | 自动扫 YES+NO < 1.0 的套利机会 |
| **模拟沙盒** | `agent_simulate_order` | 不产生真实订单，预估滑点/手续费/保证金 |

---

## 常见场景

### 用户没配 Key
公开域全可以用。问账户或交易时告诉用户去 OKX 建 Key。

### 看行情
```
okx_quick_market("BTC-USDT")        → 价格/涨跌/深度/费率
okx_indicator("BTC-USDT", "rsi")   → RSI 指标 + 信号解读
agent_market_scan("SWAP")          → 全市场异动扫描
```

### 想交易
```
okx_preflight_check → agent_simulate_order → 用户确认 → agent_quick_trade
```

### 看账户
```
okx_account_overview()                  → 全景
agent_risk_overview()                   → 风险
agent_pnl_report(days=7)               → 盈亏
```

---

## 跨客户端兼容

| 客户端 | 连接 | 配置 |
|--------|------|------|
| Claude Desktop | stdio | README 有 JSON |
| Claude Code | stdio | `.claude/settings.json` |
| Cursor | stdio | MCP Settings |
| VS Code / Cline | stdio | MCP Settings |
| Windsurf | stdio | MCP Settings |
| Gemini | HTTP | `mcp.hvip.one/mcp` |

---

## 中文提示

- 所有工具描述是中文——直接读
- `agent_catalog` 的 `when` 关键词是中文——用来匹配意图
- 参数 schema 的 `describe()` 是中文
- 如果用户讲英文，域名字可以翻译，工具名不变

---

有问题？读 [`README.md`](./README.md) · 调 `agent_catalog_detail` · [提 Issue](https://github.com/okx-wallet-H/hvip-mcp/issues/new)
