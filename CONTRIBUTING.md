# Contributing to hvip-mcp-server

> 📦 仓库: [github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp)

本文档同时面向人类开发者和 AI Agent。

---

## 🤖 AI Agent 快速入口

如果你是 AI Agent，克隆本项目后：

1. **先读** [`CLAUDE.md`](./CLAUDE.md) — 项目架构、开发规范、8 字段描述模板
2. **再看** 本文档 — 提 PR 流程和 Review 标准
3. **找需求** — 从 [`SKILL_FEEDBACK.md`](./SKILL_FEEDBACK.md) 或 [GitHub Issues](https://github.com/okx-wallet-H/hvip-mcp/issues) 找 "Skill 需求" 标签
4. **动手** — 按下面的 Skill 实现规范写代码
5. **提 PR** — 按 PR 模板填写

---

## Skill 贡献流程

### 1. 发现需求

- 查看 [`SKILL_FEEDBACK.md`](./SKILL_FEEDBACK.md) 留言板
- 浏览 [GitHub Issues](https://github.com/okx-wallet-H/hvip-mcp/issues)，找 "Skill 需求" 标签
- 原则：**每 5 条反馈就是下一个 Skill 的 input**

### 2. 创建分支

```bash
git checkout -b skill/<skill-name>
```

命名示例：`skill/portfolio-overview`、`skill/batch-grid-create`

### 3. 实现 Skill

在 `src/tools/agent-utils.ts` 中新增一个 `server.tool()` 注册。

**必须遵循的项目规范**（详见 `CLAUDE.md`）：

| 规范 | 说明 |
|------|------|
| 描述格式 | 8 字段模板：功能/场景/关键词/参数/鉴权/风险/返回量/关联 |
| 错误格式 | 统一 `toResult()` / `toError()`，含 `errorCategory` |
| 枚举 | 使用 `src/tools/shared.ts` 中的 `INST_TYPE_*` 常量 |
| 时间戳 | 必须加 `tsIso` 字段 |
| 参数校验 | 使用 Zod schema |
| 并行调用 | 用 `Promise.allSettled` 并行化多个 API 调用 |

**Skill 模式参考**（复制并修改）：

```typescript
server.tool(
  "okx_<skill_name>",
  "## 功能：<一句话描述>\n## 场景：<用于什么场景>\n## 关键词：<逗号分隔>\n## 参数：\n##   - <param>: <说明>\n## 鉴权：⚠️ 需要 API Key（只读）\n## 风险：READ — 只读查询，Agent 可自动调用\n## 返回量：微小 ~2KB\n## 关联：<前置工具> → 本工具 → <后续工具>",
  {
    param1: z.string().describe("参数说明"),
    param2: z.enum(["A","B"]).optional().describe("可选参数说明"),
  },
  async ({ param1, param2 }) => {
    if (!auth) return toError(AUTH_REQUIRED)
    try {
      // 并行调用多个 API
      const results = await Promise.allSettled([
        privateApi.getXxx(auth, param1),
        publicApi.getYyy(param2),
      ])
      // 汇总并结构化返回
      return toResult({ summary: "...", errors: [...] })
    } catch (e) { return toError(e) }
  }
)
```

### 4. 自检

```bash
npm run build    # 必须通过，不能有编译错误
```

### 5. 提交 PR

```bash
git add src/tools/agent-utils.ts
git commit -m "Skill: <功能描述>"
git push origin skill/<skill-name>
```

然后在 GitHub 上提 PR，标题格式：`Skill: <功能描述>`

**PR 描述按模板填写**（会自动加载 `.github/PULL_REQUEST_TEMPLATE.md`）。

### 6. Review & 合并

PR 提交后，CI 自动跑 `Build & Check`。Reviewer（Claude / okx-wallet-H）会检查：

- [ ] CI 是否通过
- [ ] 8 字段描述是否完整
- [ ] 是否复用已有 API 调用（不重复发明轮子）
- [ ] 是否有 `tsIso` 时间戳
- [ ] 是否使用 `toResult` / `toError`
- [ ] Skill 是否解决了真实的反馈痛点

通过后 **Squash Merge** 到 `master`。

---

## 工具修复流程

对于已有工具的 Bug 修复或参数补充：

1. 直接修改对应 `src/tools/<module>.ts` 文件
2. PR 标题：`Fix: <描述>`
3. 自检通过即可，Review 标准同 Skill

---

## 规范改进流程

对于 `CLAUDE.md`、`CONTRIBUTING.md`、CI 等非代码改进：

1. PR 标题：`Meta: <描述>`
2. 描述清楚改进了什么、为什么

---

## Review 标准（给 Reviewer）

```bash
# 列出待审 PR
gh pr list --repo okx-wallet-H/hvip-mcp

# 查看 PR
gh pr view <number> --repo okx-wallet-H/hvip-mcp

# 查看 diff
gh pr diff <number> --repo okx-wallet-H/hvip-mcp

# 通过
gh pr review <number> --approve --repo okx-wallet-H/hvip-mcp
gh pr merge <number> --squash --repo okx-wallet-H/hvip-mcp

# 请求修改
gh pr review <number> --request-changes -b "修改意见..." --repo okx-wallet-H/hvip-mcp
```
