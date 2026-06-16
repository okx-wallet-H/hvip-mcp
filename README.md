# hvip MCP Server

> OKX 全部能力接入 AI —— 365 个 MCP 工具，覆盖 97.7% OKX REST API

[![npm version](https://img.shields.io/npm/v/hvip-mcp-server)](https://www.npmjs.com/package/hvip-mcp-server)
[![License](https://img.shields.io/npm/l/hvip-mcp-server)](https://github.com/okx-wallet-H/hvip-mcp/blob/master/LICENSE)

📦 [github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp) · 🐛 [提交反馈](https://github.com/okx-wallet-H/hvip-mcp/issues/new)

---

## 安装

**这不是命令行工具**——hvip-mcp 是 MCP (Model Context Protocol) 服务器，由 AI 客户端在后台自动运行。你只需要在配置文件中加一行 JSON，AI 自己会启动它。

### Claude Desktop

Claude Desktop → 设置 → Developer → Edit Config：

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

在项目根目录或全局 `.claude/settings.json`：

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

### VS Code / Cline / 其他 MCP 客户端

在 MCP 配置中添加同样的 JSON。

> **配置完需要完全退出并重启客户端**，重开后 AI 自动连接 hvip。

### 需要 API Key？

行情、技术指标、市场扫描等公开数据无需 Key。查看账户、下单交易需要 OKX API Key：

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

> API Key 在 [OKX 官网](https://www.okx.com) → 个人中心 → API 中创建，开通「读取」权限即可查账户，「交易」权限可下单。

---

## 工作流

AI 连接 hvip 后自动执行：

```
1. tools/list  →  365 个工具，但只有 agent_catalog 带完整描述
2. agent_catalog  →  15 个域的地图（7 公开 + 8 需 Key），按需直达
3. 用户说 "BTC 怎么样"  →  AI 调 okx_quick_market
4. 用户说 "买 0.1 BTC"  →  AI 先预检再下单
```

**无需手动操作，全程 AI 自己来。**

---

## 工具覆盖

| 模块 | 工具数 | 说明 |
|------|--------|------|
| 🔹 账户 | 40+ | 余额/持仓/配置/杠杆/估值 |
| 🔹 行情 | 17 | Ticker/K线/深度/成交 |
| 🔹 交易 | 27 | 下单/撤单/改单/批量/平仓 |
| 🔹 公共数据 | 34 | 产品规格/资金费率/标记价 |
| 🔹 资金 | 18 | 划转/提现/充值/兑换 |
| 🔹 策略委托 | 6 | 止损止盈/冰山/移动止盈 |
| 🔹 网格 | 13 | 现货网格/合约网格/定投 |
| 🔹 跟单 | 23 | 交易员/跟单/带单 |
| 🔹 信号 | 10 | 信号订阅/历史信号 |
| 🔹 价差 | 16 | 跨品种/跨期价差 |
| 🔹 RFQ | 12 | 大宗询价/报价/成交 |
| 🔹 金融 | 27 | 赚币/质押/借贷 |
| 🔹 预测市场 | 36 | 事件合约/预测交易 |
| 🔹 技术指标 | 2 | RSI/MACD/布林带等 17 种 |
| 🔹 聪明钱 | 3 | 交易员排行榜/市场情绪 |
| 🔹 WebSocket | 5 | 55 频道实时推送 |
| 🔹 代码图谱 | 2 | 函数调用链/符号搜索 |
| 🔹 系统工具 | 19 | 导航/偏好/反馈/Agent 协作 |

**365 个 MCP 工具 · 覆盖 97.7% OKX REST API**

---

## 本地开发

```bash
git clone https://github.com/okx-wallet-H/hvip-mcp.git
cd hvip-mcp
npm install
npm run build
npm start
```

---

## 架构

```
原子层 (350 工具) → [L:READ] 权限标记 → AI Agent 按需调用
       ↓
Skill 组合层 (13 个) → 串联多工具，一次完成复杂任务
       ↓
agent_catalog → 15 域地图 → 按意图路由 → 直达目标工具
```

---

## 贡献

1. 阅读 [`CLAUDE.md`](./CLAUDE.md) 了解项目规范
2. 阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 了解提交流程
3. Fork → 创建分支 → 开发 → `npm run build` → 提 PR

---

## 文档

- [`CLAUDE.md`](./CLAUDE.md) — AI Agent 项目指南
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 贡献流程
- [`docs/OKX-MCP-API对接标准-v0.2.49.md`](./docs/OKX-MCP-API对接标准-v0.2.49.md) — API 对接规范
- [`docs/OKX-MCP-防幻觉对接SOP-v1.0.md`](./docs/OKX-MCP-防幻觉对接SOP-v1.0.md) — 防幻觉 SOP
