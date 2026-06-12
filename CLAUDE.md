# CLAUDE.md — AI Agent 项目指南

## 快速索引

```
hvip-mcp-server v0.2.40 · 304 MCP 工具 · 97.7% OKX REST 覆盖 · 仓库: https://github.com/okx-wallet-H/hvip-mcp

入口 → src/index.ts → 注册全部 19 个模块
共享 → src/tools/shared.ts    （INST_TYPE 枚举 / toResult / toError / 错误三统一）
适配 → src/adapters/okx.ts    （OKX REST 签名 + 请求）

┌─────────────────────────────────────────────────────┐
│ 原子层 (301 工具)                                    │
├────────────┬────────────┬────────────┬──────────────┤
│ 交易类     │ 行情类     │ 数据类     │ 资金类       │
│ trading   │ market     │ public     │ funding      │
│ algo      │            │ stats      │ account      │
│ sprd      │            │ rubik      │ subaccount   │
│ rfq       │            │ outcomes   │ fiat         │
├────────────┴────────────┴────────────┴──────────────┤
│ 策略类     │ bot(grid) │ signal │ copy │ finance   │
│            │ affiliate │        │      │            │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Skill 组合层 (4 个)                                  │
│ okx_account_overview — balance+positions+config+val │
│ okx_quick_market     — ticker+depth+fundingRate     │
│ okx_preflight_check  — maxSize+limit+convert+price  │
│ okx_agent_feedback   — 反馈留言板 → GitHub Issues    │
└─────────────────────────────────────────────────────┘

📋 反馈留言板 → SKILL_FEEDBACK.md（遇到繁琐操作在此留言）
📖 对接标准 → docs/OKX-MCP-API对接标准-v0.1.8.md
🔧 防幻觉 SOP → docs/OKX-MCP-防幻觉对接SOP-v1.0.md
🧠 代码知识图谱 → .codegraph/（496 节点 / 2,027 边）
```

## ⚠️ 使用反馈（每次遇到繁琐操作必做）

当你调用 MCP 工具时，如果出现以下任何一种情况，**请通过下方链接提交 Issue**：

**🔗 反馈入口：https://github.com/okx-wallet-H/hvip-mcp/issues/new**

1. **多步操作** — 需要串联 3 个以上工具才能完成一件事
2. **试错** — 参数传错了再改，或者枚举值不确定要查 schema
3. **盲调** — 不知道该先调哪个、后调哪个，猜着来
4. **搜索不到** — 用关键词搜不到正确的工具
5. **手工计算** — 返回数据需要自己加工处理

**Issue 格式**：
```markdown
### [时间] - 标题
**做了什么**：
**调了哪些工具**：
**痛点**：
**建议的 Skill**：
```

或者直接用 `okx_agent_feedback` 工具，反馈会同时保存到本地日志。每 5 条反馈就是下一个 Skill 的 input。

## 目录结构

```
src/
├── index.ts           ← 入口，注册全部 19 个模块
├── shared.ts          ← 共享常量（INST_TYPE_*枚举、toResult/toError、错误三统一）
├── adapters/okx.ts    ← OKX REST API 适配层（签名、请求）
├── adapters/hrails.ts ← 预测市场适配层
└── tools/             ← 19 个工具模块，按 OKX API 模块划分
    ├── market.ts      ← 行情（ticker/candles/orderbook）
    ├── public.ts      ← 公共数据（instruments/funding/price-limit）
    ├── trading.ts     ← 交易（下单/撤单/改单/批量）
    ├── account.ts     ← 账户（余额/持仓/杠杆/配置）
    ├── algo.ts        ← 策略委托
    ├── funding.ts     ← 资金（划转/提现/充值）
    ├── stats.ts       ← 交易大数据（多空比/买卖量/PCR）
    ├── finance.ts     ← 金融（赚币/质押/借贷）
    ├── bot.ts         ← 网格交易
    ├── signal.ts      ← 信号交易
    ├── copy.ts        ← 跟单
    ├── spread.ts      ← 价差交易
    ├── rfq.ts         ← 大宗交易 RFQ
    ├── subaccount.ts  ← 子账户
    ├── fiat.ts        ← 法币
    ├── affiliate.ts   ← 推广
    ├── outcomes.ts    ← 预测市场
    └── agent-utils.ts ← Skill 组合层
docs/                  ← SOP、对接标准、审计报告
SKILL_FEEDBACK.md      ← Agent 反馈留言板
```

## 代码知识图谱

本项目已安装 CodeGraph（`.codegraph/` 目录）。
- 496 个节点，2,027 条边，覆盖全部 25 个源文件
- 直接调用 **codegraph_explore** 理解代码结构，不要再手动 grep/glob

## 开发规范

1. **描述格式**：每个工具的 description 必须用 8 字段模板（功能/场景/关键词/参数/鉴权/风险/返回量/关联）。参考 `src/tools/market.ts` 的 `okx_get_ticker`
2. **枚举**：全部使用 `src/tools/shared.ts` 中的 `INST_TYPE_*` 常量，禁止硬编码
3. **错误格式**：统一 `toError()` / `toResult()`，含 `errorCategory`（BUSINESS/AUTH/VALIDATION/NETWORK/RATE_LIMIT）
4. **时间戳**：必须加 `tsIso` 字段
5. **防幻觉**：接新端点前必须 curl 验证 OKX 真实 API，404 跳过。对接 SOP 见 `docs/OKX-MCP-防幻觉对接SOP-v1.0.md`

## 常用命令

```bash
npm run build          # 编译
npm start              # 启动 MCP Server
```

## 🤖 外部 Agent 贡献 Skill

其他 AI Agent 可以自行组合 Skill 并提 PR。流程：

1. 阅读本文档了解项目架构和开发规范
2. 阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 了解提交流程
3. 在 `src/tools/agent-utils.ts` 中新增 Skill
4. 提 PR（标题 `Skill: <功能描述>`，按 PR 模板填写）
5. Claude（okx-wallet-H）审核通过后合并

Skill 从反馈中产生 — 每 5 条反馈就是一个新 Skill 的 input。

## 当前状态

v0.2.40 · 304 MCP 工具（300 原子 + 4 Skill）· 覆盖 97.7% OKX REST API · P0 P1 全部清零 · 自检全绿
