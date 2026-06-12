# Contributing to hvip-mcp-server

> 📦 仓库: [github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp)

本文档同时面向人类开发者和 AI Agent。

---

## 🤖 AI Agent 快速入口

如果你是 AI Agent，克隆本项目后：

1. **先读** [`CLAUDE.md`](./CLAUDE.md) — 项目架构、开发规范、8 字段描述模板
2. **再看** 本文档 — 分支协作流程和 Review 标准
3. **找需求** — 从 `tasks/` 目录或 [GitHub Issues](https://github.com/okx-wallet-H/hvip-mcp/issues) 找任务
4. **动手** — 按下面的规范写代码
5. **Push 分支** — 审核员会本地 review 后合并

---

## 分支协作流程（不走 PR）

### 1. 创建分支

```bash
# 任务池工单
git checkout -b task/T-XXX

# 自定义 Skill
git checkout -b skill/<skill-name>
```

### 2. 实现

按任务文件（`tasks/T-XXX.md`）的规格写代码。必须遵循：

| 规范 | 说明 |
|------|------|
| 描述格式 | 8 字段模板：功能/场景/关键词/参数/鉴权/风险/返回量/关联 |
| 错误格式 | 统一 `toResult()` / `toError()` |
| 枚举 | 使用 `INST_TYPE_*` 常量 |
| 时间戳 | 必须加 `tsIso` 字段 |
| 参数校验 | Zod schema |
| 并行调用 | `Promise.allSettled` |

### 3. 自检

```bash
npm run build    # 必须通过
```

### 4. Push 分支 + 通知

```bash
git push origin task/T-XXX
```

然后通知审核员：
- **WS Hub**: 连上 `ws://localhost:9321`，发 `task:done` 消息
- **或者**在对应 Issue 下评论分支名

### 5. 审核 & 合并

审核员（Claude）会：
1. `git fetch origin` 拉分支
2. `git diff origin/master...origin/task/T-XXX` 审查
3. 通过 → `git merge --squash` → `git push origin master`
4. 不通过 → 在分支下留 comment 或通过 WS Hub 返回修改意见

---

## Skill 模式参考

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
      const results = await Promise.allSettled([
        privateApi.getXxx(auth, param1),
        publicApi.getYyy(param2),
      ])
      return toResult({ summary: "...", errors: [...] })
    } catch (e) { return toError(e) }
  }
)
```

---

## 审核标准

- [ ] `npm run build` 通过
- [ ] 8 字段描述完整
- [ ] 是否复用已有 API 调用
- [ ] 是否有 `tsIso` 时间戳
- [ ] 是否使用 `toResult` / `toError`
- [ ] Skill 是否解决了真实痛点

---

## 审核员操作（内部）

```bash
# 列出所有远程 task 分支
git fetch origin
git branch -r | grep 'origin/task/'

# 审查
git diff origin/master...origin/task/T-XXX

# 合并
git merge --squash origin/task/T-XXX
git commit -m "Skill: <描述>"
git push origin master

# 清理
git push origin --delete task/T-XXX
```
