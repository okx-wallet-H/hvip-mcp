# hvip MCP Server

> OKX API 全景图 —— 让任何 AI Agent 都能使用 OKX 的全部能力。

[![npm version](https://img.shields.io/npm/v/hvip-mcp-server)](https://www.npmjs.com/package/hvip-mcp-server)
[![License](https://img.shields.io/npm/l/hvip-mcp-server)](https://github.com/okx-wallet-H/hvip-mcp/blob/master/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/okx-wallet-H/hvip-mcp)](https://github.com/okx-wallet-H/hvip-mcp)

📦 **仓库**: [github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp)
🐛 **Issue**: [提交反馈](https://github.com/okx-wallet-H/hvip-mcp/issues/new)
📖 **贡献**: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 快速开始

### 1. Claude Desktop 接入

在 Claude Desktop 配置中添加：

```json
{
  "mcpServers": {
    "hvip-mcp": {
      "command": "npx",
      "args": ["-y", "hvip-mcp-server"],
      "env": {
        "OKX_API_KEY": "<你的API Key>",
        "OKX_SECRET_KEY": "<你的Secret Key>",
        "OKX_PASSPHRASE": "<你的Passphrase>"
      }
    }
  }
}
```

### 2. 直接运行

```bash
npx hvip-mcp-server
```

### 3. 本地开发

```bash
git clone https://github.com/okx-wallet-H/hvip-mcp.git
cd hvip-mcp
npm install
npm run build
npm start
```

---

## 工具覆盖

| 模块 | 工具数 | 说明 |
|------|--------|------|
| 🔹 **交易类** | 40+ | 下单/撤单/改单/批量/策略委托 |
| 🔹 **行情类** | 30+ | Ticker/K线/深度/资金费率/标记价 |
| 🔹 **数据类** | 50+ | 产品信息/多空比/买卖量/PCR/统计数据 |
| 🔹 **资金类** | 40+ | 划转/提现/充值/余额/持仓/杠杆 |
| 🔹 **策略类** | 20+ | 网格/信号/跟单/价差/RFQ |
| 🔹 **金融类** | 15+ | 赚币/质押/借贷/法币 |
| 🔹 **预测市场** | 9+ | 事件/市场/深度/套利检测 |
| 🔹 **Skill 组合** | 4 | 账户全景/市场速览/下单预检/反馈 |

**304 个 MCP 工具 · 覆盖 97.7% OKX REST API · P0 P1 全部清零**

---

## 架构

```
原子层 (300+ 工具)  →  AI Agent 直接调用
    ↓
Skill 组合层 (4 个) →  串联多工具，一次完成复杂任务
    ↓
反馈通道 → GitHub Issues → 新 Skill 需求 → AI Agent 自行实现并提 PR
```

---

## 贡献

AI Agent 或开发者都可以贡献 Skill：

1. 阅读 [`CLAUDE.md`](./CLAUDE.md) 了解项目规范
2. 阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 了解提交流程
3. Fork → 创建 Skill → 提 PR → Review → 合并

每个 Skill 串联多个原子工具，解决一个具体的使用场景。

---

## 文档

- [`CLAUDE.md`](./CLAUDE.md) — AI Agent 项目指南
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Skill 贡献流程
- [`docs/OKX-MCP-API对接标准-v0.1.8.md`](./docs/OKX-MCP-API对接标准-v0.1.8.md) — API 对接规范
- [`docs/OKX-MCP-防幻觉对接SOP-v1.0.md`](./docs/OKX-MCP-防幻觉对接SOP-v1.0.md) — 防幻觉 SOP
