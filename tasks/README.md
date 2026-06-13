# 预测市场 API 对接任务池

> 审核员：Claude (okx-wallet-H) · 流程图：接任务 → 读任务文件 → 实现 → push 分支 → 审核 → squash merge

## 工作流程

1. 在下面挑一个 `🟢 待认领` 的任务
2. 读对应任务文件（`tasks/T-*.md`），里面有完整的端点列表、代码模板、验收标准
3. `git checkout -b task/<编号>` 开始写
4. 按任务文件的标准写代码 → `npm run build` 通过 → `git push origin task/<编号>`
5. 审核员 1 小时内会 review，通过即 squash merge 到 master

## 任务池

| 编号 | 标题 | 端点数 | 难度 | 状态 |
|------|------|:---:|:---:|:---:|
| [T-001](./T-001.md) | Outcomes 事件市场查询 | 5 | ⭐ | ✅ 已合并 (PR #3) |
| [T-002](./T-002.md) | Outcomes 市场数据 | 3 | ⭐ | ✅ 已合并 (PR #3) |
| [T-003](./T-003.md) | Outcomes 订单管理 | 6 | ⭐⭐ | ✅ 已实现 (PR #12) |
| [T-004](./T-004.md) | Outcomes 持仓 & 账户 | 6 | ⭐⭐ | ✅ 已实现 (PR #13) |
| [T-005](./T-005.md) | 事件合约交易 | 5 | ⭐⭐⭐ | ✅ 已实现 (PR #11) |
| [T-006](./T-006.md) | H Rails /markets 列表 | 1 | ⭐ | ✅ 已合并 (PR #3) |
| | | | | |
| **WS-01** | WebSocket 公共行情频道 | 5 | ⭐⭐ | 🟢 **新! 待认领** |
| **WS-02** | WebSocket 私有频道 | 5 | ⭐⭐⭐ | 🟢 **新! 待认领** |
| **WS-03** | WebSocket K 线频道 | 6 | ⭐ | 🟢 **新! 待认领** |

## 提交规范

- 文件名：`src/tools/outcomes.ts`（追加，不新建文件）
- Tool 命名：`okx_<功能>` 或 `outcomes_<功能>`
- commit 标题：`Skill: <T-编号> — <一句话>`
- Push 后通知审核员（WS Hub 发 `task:done` 或在 Issue 下评论）
- 描述格式：**必须用 8 字段模板**（功能/场景/关键词/参数/鉴权/风险/返回量/关联）
- 错误格式：`toResult()` / `toError()`
- 时间戳：必须加 `tsIso`

## 参考文件

- 代码模式参考：`src/tools/outcomes.ts`（已有 10 个工具）
- API 适配器：`src/adapters/okx.ts`（`publicApi` / `privateApi`）
- 共享工具：`src/tools/shared.ts`（`toResult` / `toError` / `INST_TYPE_*`）
- 规范：`CLAUDE.md`
- 贡献流程：`CONTRIBUTING.md`
- API 文档：`docs/OKX预测市场API全集.md`
- WebSocket 参考：`src/adapters/ws.ts`（已有 OKX 行情 WS 实现）
