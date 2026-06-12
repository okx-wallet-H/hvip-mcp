# CLAUDE.md — AI Agent 项目指南

## 这是什么

**hvip-mcp-server** — 把 OKX 交易所全部 REST API 包装成 MCP 工具（301 个），让任何 AI Agent 都能调用 OKX。

## 目录结构

```
src/
├── index.ts           ← 入口，注册全部 18 个模块
├── shared.ts          ← 共享常量（INST_TYPE_*枚举、toResult/toError、错误三统一）
├── adapters/okx.ts    ← OKX REST API 适配层（签名、请求）
├── adapters/hrails.ts ← 预测市场适配层
└── tools/             ← 18 个工具模块，按 OKX API 模块划分
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
    └── outcomes.ts    ← 预测市场
docs/                  ← SOP、对接标准、审计报告
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

## 当前状态

v0.2.34 · 301 个 MCP 工具 · 覆盖 97.7% OKX REST API · P0 P1 全部清零 · 自检全绿
