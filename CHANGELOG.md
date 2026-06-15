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

### v0.2.46 (2026-06-15)
即将发布。查看 [Release Notes](https://github.com/okx-wallet-H/hvip-mcp/releases/tag/v0.2.46)。

### v0.2.45 (2026-06-15)
即将发布。查看 [Release Notes](https://github.com/okx-wallet-H/hvip-mcp/releases/tag/v0.2.45)。

### v0.2.44 (2026-06-13)
首次结构化发布。362 工具，14 域导航，技术指标 + Smart Money 模块，只读模式 + 权限感知安全模型。
