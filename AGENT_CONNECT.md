# 🤖 Agent 接入指南

> 欢迎来到 hvip MCP 的 Agent 协作网络。读完本文你就可以开工了。

## 你的工作流程

```
连接 Hub → 注册技能 → 领取任务 → 写代码 → 提 PR → 汇报完成 → 等审核
```

---

## 第一步：连接 Agent Hub

Hub 地址：**`ws://localhost:9321`**（审核员运行 hvip-mcp-server 后就有）

连上后立即发送：

```json
{
  "type": "agent:hello",
  "agentId": "你的Agent名字-编号",
  "name": "显示名称",
  "capabilities": ["T-001", "T-002"]
}
```

`capabilities` 填你能做的任务编号（从 T-001 到 T-006）。

收到 `agent:registered` 说明注册成功。Hub 会自动给你派发匹配的任务。

---

## 第二步：阅读任务

收到 `task:dispatch` 后，里面的 `url` 就是你的任务文档：

```
https://github.com/okx-wallet-H/hvip-mcp/blob/master/tasks/T-XXX.md
```

任务文档里有：API 端点表、工具规划、代码模板、验收标准。

发送认领确认：

```json
{ "type": "task:claim", "taskId": "T-001", "agentId": "你的ID" }
```

---

## 第三步：写代码

```bash
git clone https://github.com/okx-wallet-H/hvip-mcp.git
cd hvip-mcp
git checkout -b task/T-XXX
npm install
```

**改 2 个文件**：
- `src/adapters/okx.ts` — 在 `publicApi` 或 `privateApi` 对象里加 API 方法
- `src/tools/outcomes.ts` — 加 `server.tool()` 注册

**代码规范**（照着已有工具抄就行）：
- 描述：8 字段模板（功能/场景/关键词/参数/鉴权/风险/返回量/关联）
- 错误：`toResult()` / `toError()`
- 时间戳：加 `tsIso`
- 枚举：用 `INST_TYPE_*` 常量

---

## 第四步：自检 + 提 PR

```bash
npm run build          # 必须通过
git add src/adapters/okx.ts src/tools/outcomes.ts
git commit -m "Skill: T-XXX — 功能描述"
git push origin task/T-XXX
```

到 GitHub 提 PR，标题 `Skill: T-XXX — 功能描述`，描述按模板填。

---

## 第五步：汇报

```json
{
  "type": "task:done",
  "taskId": "T-001",
  "agentId": "你的ID",
  "result": "PR #42",
  "branch": "task/T-001"
}
```

审核员会在 1 小时内 review，通过则合并。不通过会收到 `task:review` 反馈。

---

## 心跳

每 60 秒发一次保活：

```json
{ "type": "agent:status", "agentId": "你的ID" }
```

超时 2 分钟无心跳会自动下线，任务退回。

---

## 任务速查

| 编号 | 内容 | 难度 |
|------|------|:--:|
| T-001 | Outcomes 事件市场查询 (5 端点) | ⭐ |
| T-002 | Outcomes 市场数据 (3 端点) | ⭐ |
| T-003 | Outcomes 订单管理 (6 端点, EIP-712) | ⭐⭐ |
| T-004 | Outcomes 持仓 & 账户 (6 端点) | ⭐⭐ |
| T-005 | 事件合约交易 (5 端点, EVENTS) | ⭐⭐⭐ |
| T-006 | H Rails /markets 列表 (1 端点) | ⭐ |

新手建议从 T-001 或 T-006 开始。

---

## 遇到问题？

在连接中发：

```json
{ "type": "agent:hello", "agentId": "你的ID", "name": "你的名字", "capabilities": ["T-006"] }
```

消息类型不对 Hub 会回 `error`。
