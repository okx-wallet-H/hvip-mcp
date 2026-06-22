# hvip MCP Server

> **最全面的 OKX MCP Server —— 374 个工具覆盖 ~99.7% OKX REST API，内置 VBT 信号引擎、17 种技术指标 AI 解读、聪明钱追踪、预测市场套利扫描。**
>
> *The most comprehensive OKX MCP server — 374 tools covering ~99.7% of OKX REST API with VBT signal engine, AI-interpreted indicators, Smart Money analysis, and prediction market arbitrage.*

[![npm version](https://img.shields.io/npm/v/hvip-mcp-server)](https://www.npmjs.com/package/hvip-mcp-server)
[![License: MIT](https://img.shields.io/npm/l/hvip-mcp-server)](https://github.com/okx-wallet-H/hvip-mcp/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/okx-wallet-H/hvip-mcp)](https://github.com/okx-wallet-H/hvip-mcp)

📦 [github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp) · 🐛 [提交反馈](https://github.com/okx-wallet-H/hvip-mcp/issues/new)

---

## 🚀 一行安装

```bash
npx -y hvip-mcp-server
```

---

## ⚡ 一句话说清楚

> **不只是 OKX API 搬运工。** hvip 内置 VBT 多指标共振信号、17 种指标 AI 解读、聪明钱追踪、预测市场套利。Agent 调一个工具拿到的是分析结论，不是原始 JSON。

---

## 🧭 AI Agent 使用必读

**你是 AI，刚连上 hvip MCP Server？请按这个流程走：**

1. **第一步：调 `agent_catalog`** → 拿到 15 个功能域完整地图（7 个公开 + 8 个需 Key）
2. **搞清楚用户想干什么** → 匹配到域 → 看该域的 `go_to` 工具 → 直接调用
3. **所有 [L:WRITE] / [L:FUND_TRANSFER] 工具必须向用户确认** ← 不可自动发起交易或划转
4. **新会话先调 `agent_get_preference`** → 恢复用户偏好（默认交易对 / 风险偏好 / 仓位占比）
5. **先模拟后交易** → `agent_simulate_order` 预估 → 用户确认 → `agent_quick_trade` 下单

> *For English-speaking agents: call `agent_catalog` first. The catalog returns domain names in Chinese but all tool names and descriptions are bilingual. Follow `_instruction` for workflow.*

---

## 🔌 配置到 AI 客户端

hvip-mcp 是 MCP (Model Context Protocol) 服务器，由 AI 客户端后台自动运行。在配置文件中加几行 JSON 就行。

### Claude Desktop

设置 → Developer → Edit Config：

```json
{
  "mcpServers": {
    "hvip": {
      "command": "npx",
      "args": ["-y", "hvip-mcp-server"]
    }
  }
}
```

### Claude Code

项目根目录或全局 `.claude/settings.json`：

```json
{
  "mcpServers": {
    "hvip": {
      "command": "npx",
      "args": ["-y", "hvip-mcp-server@latest"]
    }
  }
}
```

### Cursor / VS Code / Cline / Windsurf / Gemini

同样的 MCP 配置。在对应客户端的 MCP Settings 中添加。

> **配置完后必须完全退出并重启客户端。**

### 需要 OKX API Key？

行情、指标、市场扫描 → 不需要 Key。看账户、下单 → 需要：

```json
{
  "mcpServers": {
    "hvip": {
      "command": "npx",
      "args": ["-y", "hvip-mcp-server"],
      "env": {
        "OKX_API_KEY": "<你的 API Key>",
        "OKX_SECRET_KEY": "<你的 Secret Key>",
        "OKX_PASSPHRASE": "<你的 Passphrase>"
      }
    }
  }
}
```

> 在 [OKX 官网](https://www.okx.com) → 个人中心 → API 创建，开通「读取+交易」权限。

---

## 📊 功能域

### 🔴 第一梯队 — Agent 最高频使用

| 域 | 入口工具 | 数量 | 能干什么 |
|----|----------|------|----------|
| 🟢 **行情看盘** | `okx_quick_market` | 50+ | 实时行情、K线、深度、成交、资金费率 |
| 🟢 **技术指标** | `okx_indicator` | 2 | RSI/MACD/布林带/ADX 等 17 种，带 AI 信号解读 |
| 🟢 **市场扫描** | `agent_market_scan` | 5 | 涨幅榜、跌幅榜、费率异动、成交量异常 |
| 🟢 **模拟沙盒** | `agent_simulate_order` | 3 | 模拟下单、滑点估算、手续费预估——不产生真实订单 |
| 🔴 **账户资产** | `okx_account_overview` | 55+ | 余额、持仓、配置、杠杆、估值、子账户 |
| 🔴 **下单交易** | `agent_quick_trade` | 34 | 下单、撤单、改单、平仓、批量、预检 |
| 🔴 **风险风控** | `agent_risk_overview` | 3 | 强平预警、保证金率、一键止损 |

### 🟡 第二梯队 — 策略与资金

| 域 | 入口工具 | 数量 | 能干什么 |
|----|----------|------|----------|
| 🔴 **策略交易** | `okx_get_grid_ai_param` | 80+ | 网格、跟单、信号、策略委托、价差、RFQ |
| 🔴 **盈亏复盘** | `agent_pnl_report` | 5 | 浮动盈亏、已实现盈亏、逐日绩效 |
| 🔴 **资金管理** | `okx_get_balance` | 49+ | 划转、提现、充值、闪兑、理财、借贷 |

### 🟢 第三梯队 — 专业工具

| 域 | 入口工具 | 数量 | 能干什么 |
|----|----------|------|----------|
| 🟢 **WebSocket 实时** | `okx_ws_subscribe` | 10 | 55 个频道实时推送 |
| 🔴 **聪明钱** | `okx_smart_leaderboard` | 13 | 交易员排行榜、深度分析、市场情绪评分 |
| 🔴 **预测市场** | `okx_event_instruments` | 36 | 事件合约、预测交易、YES+NO 套利扫描 |

### ⚙️ 系统

| 域 | 入口工具 | 数量 | 能干什么 |
|----|----------|------|----------|
| 🟢 **系统** | `agent_get_preference` | 10+ | 偏好设置、使用统计、Agent Hub、X Layer 链上 |
| 🟢 **代码智能** | `codegraph_status` | 2 | 代码调用链追踪、符号搜索 |

> 🟢 无需 API Key　🔴 需 OKX API Key

---

## 🏆 我们有，别人没有

| 能力 | 为什么重要 |
|------|-----------|
| **VBT 信号引擎** | RSI + MACD + KDJ + ADX + 布林带 5 指标共振，S/A/B/C 四级信号。Agent 不只看到价格，看到的是交易机会 |
| **AI 指标解读** | 17 种技术指标返回的不是纯数值——Agent 直接拿到「超买」「超卖」「金叉」「死叉」结论 |
| **聪明钱追踪** | 交易员排行榜 + 深度分析 + 情绪仪表盘。一键发现市场上聪明钱在干嘛 |
| **预测市场套利** | 自动扫描 YES + NO < 1.0 的机会，Agent 拿到套利列表 |
| **模拟沙盒** | 先模拟后交易——滑点多少、手续费多少、占多少保证金，下单前全知道 |
| **多 Agent 集群** | Chronos 调度官 + V2 Worker + 自愈闭环 + 熔断器 |
| **代码自省** | `codegraph_query` 让 Agent 理解 hvip 自身代码结构 |

---

## 🏗 架构

```
外部分析师 Agent    外部分析师 Agent    外部分析师 Agent
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │ MCP 协议
                    ┌───────▼────────┐
                    │  agent_catalog │ ← 15 域入口
                    │  意图 → 工具    │
                    ├────────────────┤
                    │ Skill 层 (21)  │ ← 一键完成复杂任务
                    │ 原子层 (350+)  │ ← 精确控制每个 API
                    ├────────────────┤
                    │  内部集群       │
                    │  Chronos 调度官 │
                    │  V2 Worker × 2 │
                    │  自愈 + 熔断    │
                    └────────────────┘
```

---

## 🔧 本地开发

```bash
git clone https://github.com/okx-wallet-H/hvip-mcp.git
cd hvip-mcp
npm install
npm run build
npm start
```

---

## 📖 参与贡献

1. 读 [`CLAUDE.md`](./CLAUDE.md) — 项目规范
2. 读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 提交流程
3. Fork → 开分支 → `npm run build` → Push → 审核 squash-merge

Agent 协作开发详见 [`AGENTS.md`](./AGENTS.md)。

---

## 📚 文档

| 文档 | 谁看 |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | **外部 AI Agent 首次连接必读** |
| [`CLAUDE.md`](./CLAUDE.md) | 开发 Agent 项目指南 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 人类贡献者 |
| [`SECURITY.md`](./SECURITY.md) | 安全政策 |
| [`docs/benchmark-report-2026-06-22.md`](./docs/benchmark-report-2026-06-22.md) | 行业基准报告 |

---

## ⚠️ 声明

hvip-mcp-server 非 OKX 官方产品。API Key 仅存本地，不上传任何服务器。使用前读 [`SECURITY.md`](./SECURITY.md)。
