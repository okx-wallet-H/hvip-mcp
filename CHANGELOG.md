# Changelog

所有发布记录通过 GitHub Releases 管理，自动生成于每次版本号叠加后。

## 查看方式

- **GitHub Releases**: https://github.com/okx-wallet-H/hvip-mcp/releases
- **npm 版本历史**: https://www.npmjs.com/package/hvip-mcp-server?activeTab=versions
- **GitHub 提交记录**: https://github.com/okx-wallet-H/hvip-mcp/commits/master

## 版本规则

- **patch** (0.2.44 → 0.2.45) — Bug 修复、小改进，`npm version patch`
- **minor** (0.2.44 → 0.3.0) — 新模块、新功能，`npm version minor`
- **major** (0.2.44 → 1.0.0) — 重大架构变更，`npm version major`

## 发布流程

```
GitHub Actions → Bump & Publish → 选叠加级别 → 自动：
  1. 叠加 package.json 版本号
  2. 同步到 CLAUDE.md + src/index.ts
  3. build + 自检
  4. git commit + tag + push
  5. npm publish
  6. GitHub Release（从 PR 历史自动生成 Release Notes）
```

## 历史版本

### v0.5.0 (2026-06-19) — 当前版本
373 MCP 工具，~99.7% OKX REST 覆盖，6 进程 AI 集群。
AI Trader 交易桥接 (simulate/demo/live)，Dashboard v2 React 仪表盘，
Chronos 调度官 + V2 Worker 执行引擎，自愈闭环，熔断告警，成本追踪。

### v0.4.0 (2026-06-16)
AI 集群架构：Agent Hub + Chronos Dispatcher + Worker 执行引擎。
PM2 守护，11 岗 AI 值守，VBT 信号引擎 v3。

### v0.3.0 (2026-06-14)
Dashboard v1 HTML 仪表盘，Agent 辩论系统，信号面板。
MCP 工具扩展至 ~350。

### v0.2.44 (2026-06-13)
首次结构化发布。362 工具，14 域导航，技术指标 + Smart Money 模块，
只读模式 + 权限感知安全模型。
