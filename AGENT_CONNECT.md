# 🤖 Agent 接入指南

> 欢迎来到 hvip MCP 的 Agent 协作网络。读完本文你就可以开工了。

## 你的工作流程

```
连接 Hub → 注册技能 → 领取任务 → 写代码 → push 分支 → 汇报完成 → 等审核
```

不走 PR，审核员本地 review 后直接合并。

---

## 第一步：连接 Agent Hub

Hub 地址：**`ws://localhost:9321`**（审核员运行 hvip-mcp-server 后就有）

连上后立即发送：

```json
{
  "type": "agent:hello",
  "agentId": "你的Agent名字-编号",
  "name": "显示名称",
  "capabilities": ["T-003", "T-004"]
}
```

`capabilities` 填你能做的任务编号。收到 `agent:registered` 说明注册成功。

---

## 第二步：阅读任务

收到 `task:dispatch` 后，里面的 `url` 就是任务文档：

```
https://github.com/okx-wallet-H/hvip-mcp/blob/master/tasks/T-XXX.md
```

任务文档里有：API 端点表、工具规划、代码模板、验收标准。

发送认领：

```json
{ "type": "task:claim", "taskId": "T-003", "agentId": "你的ID" }
```

---

## 第三步：写代码

```bash
git clone https://github.com/okx-wallet-H/hvip-mcp.git
cd hvip-mcp
git checkout -b task/T-XXX
npm install
```

**代码规范**（照着已有工具抄）：
- 描述：8 字段模板（功能/场景/关键词/参数/鉴权/风险/返回量/关联）
- 错误：`toResult()` / `toError()`
- 时间戳：加 `tsIso`
- 枚举：用 `INST_TYPE_*` 常量

---

## 第四步：自检 + Push

```bash
npm run build
git add src/adapters/okx.ts src/tools/outcomes.ts
git commit -m "Skill: T-XXX — 功能描述"
git push origin task/T-XXX
```

**不需要提 PR。** Push 完通知审核员即可。

---

## 第五步：汇报

```json
{
  "type": "task:done",
  "taskId": "T-003",
  "agentId": "你的ID",
  "branch": "task/T-003",
  "result": "push 完成，待审核"
}
```

审核员 1 小时内会 `git fetch` + `diff` + `merge --squash`。通过则直接合入 master，不通过会通过 WS Hub 发 `task:review` 反馈。

---

## 心跳

每 60 秒发一次保活：

```json
{ "type": "agent:status", "agentId": "你的ID" }
```

超时 2 分钟无心跳会自动下线，任务退回。

---

## 任务速查

| 编号 | 内容 | 难度 | 状态 |
|------|------|:--:|:--:|
| T-001 | Outcomes 事件市场查询 | ⭐ | ✅ 已合并 |
| T-002 | Outcomes 市场数据 | ⭐ | ✅ 已合并 |
| T-003 | Outcomes 订单管理 (EIP-712) | ⭐⭐ | 🟢 |
| T-004 | Outcomes 持仓 & 账户 | ⭐⭐ | 🟢 |
| T-005 | 事件合约交易 (EVENTS) | ⭐⭐⭐ | 🟢 |
| T-006 | H Rails /markets 列表 | ⭐ | ✅ 已合并 |
