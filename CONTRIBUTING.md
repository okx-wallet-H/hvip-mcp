# Contributing to hvip-mcp-server

> 📦 仓库：[github.com/okx-wallet-H/hvip-mcp](https://github.com/okx-wallet-H/hvip-mcp)
> 流程标准：参照 **OKX 官方** + **GitHub Flow**（业界标准）

本文档同时面向人类开发者和 AI Agent。

---

## 一、开发流程总览

```
Issue / 任务池 → 创建 feature 分支 → 开发 → 自检 → Push → CI 检查 → Review → Squash Merge → 删分支
```

**禁止直推 master。** 所有改动必须走分支 → 审核 → 合并流程。

---

## 二、分支命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能 / 新工具 / 新 Skill | `feat/risk-overview` |
| `fix/` | Bug 修复 | `fix/tsiso-missing` |
| `docs/` | 文档 | `docs/api-guide` |
| `refactor/` | 代码重构 | `refactor/shared-types` |
| `chore/` | 构建/依赖/配置 | `chore/update-deps` |
| `task/` | 任务池工单 | `task/T-003` |

**严禁**：`skill/xxx`、`task/T-XXX-blah`、`fix-bug`、带空格/下划线混合。

---

## 三、开发流程

### Step 1：创建分支

```bash
git checkout master
git pull origin master
git checkout -b feat/<slug>
```

### Step 2：开发

遵守 **8 字段规范**（详见 `CLAUDE.md`）：

- 描述模板：`## 功能 / ## 场景 / ## 关键词 / ## 参数 / ## 鉴权 / ## 风险 / ## 返回量 / ## 分类 / ## 关联`
- 错误格式：`toResult()` / `toError()`
- 时间戳：必须含 `tsIso`
- 枚举：使用 `INST_TYPE_*`
- 端点：必须在本项目的 API 对接标准内有记录
- WS 频道：必须为 OKX 官方文档记载的真实频道

### Step 3：自检

```bash
npm run build    # 必须通过
```

### Step 4：Push

```bash
git push origin feat/<slug>
```

**不需要提 PR。** Push 到远程分支即触发 CI 检查。

### Step 5：通知审核员

- **WS Hub**：连接 `ws://localhost:9321`，发送 `task:done`
- 或在对应 Issue 下评论分支名

### Step 6：审核

审核员（Claude）每 1 小时自动巡检：

| 检查项 | 标准 |
|--------|------|
| Build | `npm run build` 通过 |
| 8 字段 | 功能/场景/关键词/参数/鉴权/风险/返回量/分类/关联 全部完整 |
| 端点真实性 | REST 端点经 curl 验证，WS 频道在 OKX 官方文档有记录 |
| 代码质量 | 不破坏现有代码，不修改无关文件，复用已有 API |

**通过** → Squash Merge → 推 `master` → 删远程分支

**不通过** → 保留分支，附具体修改意见

---

## 四、发布流程

1. **你** 决定版本号
2. **你** 批准发布
3. **Claude** 执行 `npm publish`
4. 发布后重启 Hub → Agent 连上来版本不一致自动收到 `agent:upgrade`

---

## 五、审核标准（完整清单）

- [ ] `npm run build` 通过
- [ ] 8 字段描述完整（含 CAT 分类）
- [ ] `tsIso` 时间戳
- [ ] `toResult()` / `toError()` 错误处理
- [ ] `INST_TYPE_*` 枚举（如涉及）
- [ ] `Promise.allSettled` 并行调用（多 API 时）
- [ ] 端点/频道真实存在（防幻觉）
- [ ] 不破坏现有代码
- [ ] 分支命名符合规范

---

## 六、AI Agent 快速入口

如果你是 AI Agent：

1. 读 `CLAUDE.md` + `CONTRIBUTING.md`
2. 从 `tasks/` 或 Issues 找任务
3. `git checkout -b task/T-XXX` → 开发 → `npm run build` → push
4. Push 后通知审核员
5. 审核通过即合并

---

## 七、审核员操作（内部参考）

```bash
git fetch origin
git branch -r | grep -E 'origin/(feat|fix|task|refactor|chore)/'

# 审查
git diff origin/master...origin/<branch>

# 通过
git merge --squash origin/<branch>
git commit -m "Skill: <描述>"
git push origin master
git push origin --delete <branch>

# 不通过 — 保留分支，留反馈
```
