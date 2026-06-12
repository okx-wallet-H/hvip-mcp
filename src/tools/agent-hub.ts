import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { agentHub } from "../adapters/agent-hub.js"
import { toResult, toError } from "./shared.js"

export function registerAgentHubTools(server: McpServer): void {

  // ── agent_hub_status ──────────────────────────────────────────────────
  server.tool(
    "agent_hub_status",
    "## 功能：查看 Agent Hub 全景：所有在线 Agent、任务分配状态、任务进度\n## 场景：用于巡检 Agent 集群健康状况、了解哪些任务在推进、哪个 Agent 空闲可派活\n## 关键词：Agent Hub, 集群状态, 任务进度, 在线Agent, 调度面板\n## 参数：无\n## 鉴权：PUBLIC — Agent Hub 内部接口\n## 风险：READ — 只读状态查询\n## 返回量：微小 ~1KB\n## 关联：本工具查看全局 → agent_hub_dispatch 派发任务 → agent_hub_review 审核结果",
    {},
    async () => {
      try {
        return toResult(agentHub.status())
      } catch (e) { return toError(e) }
    }
  )

  // ── agent_hub_dispatch ──────────────────────────────────────────────────
  server.tool(
    "agent_hub_dispatch",
    "## 功能：向指定 Agent 或全体在线 Agent 派发任务\n## 场景：用于手动将任务池中的工单分发给空闲 Agent、补充自动派发未覆盖的任务\n## 关键词：派发, dispatch, 任务分配, 调度, assign\n## 参数：\n##   - taskId: 任务编号（T-001 ~ T-006）\n##   - agentId: 目标 Agent ID（选填，不填则找第一个匹配的）\n## 鉴权：PUBLIC — 调度控制接口\n## 风险：READ — 只派发消息，不修改代码\n## 返回量：微小 ~200B\n## 关联：agent_hub_status 查看 Agent 状态 → 本工具派发 → Agent 收到 task:dispatch",
    {
      taskId:  z.enum(["T-001","T-002","T-003","T-004","T-005","T-006"]).describe("任务编号"),
      agentId: z.string().optional().describe("目标 Agent ID。不填则自动匹配有对应技能的 Agent"),
    },
    async ({ taskId, agentId }) => {
      try {
        const status = agentHub.status()

        if (agentId) {
          // 指定 Agent
          const agent = status.agents.find(a => a.agentId === agentId)
          if (!agent) {
            return toResult({
              dispatched: false,
              reason: `Agent ${agentId} 不在线`,
              onlineAgents: status.agents.map(a => a.agentId),
            })
          }
          agentHub.dispatchTaskTo(taskId, agentId)
          return toResult({
            dispatched: true,
            taskId,
            agentId,
            message: `已向 ${agentId} (${agent.name}) 派发 ${taskId}`,
          })
        }

        // 自动找匹配的 Agent
        const capable = status.agents.filter(a =>
          a.status === "idle" && a.capabilities.includes(taskId)
        )
        if (capable.length === 0) {
          return toResult({
            dispatched: false,
            reason: `没有空闲且技能匹配 ${taskId} 的 Agent`,
            onlineAgents: status.agents.map(a => ({ id: a.agentId, status: a.status, skills: a.capabilities })),
          })
        }

        const target = capable[0]
        agentHub.dispatchTaskTo(taskId, target.agentId)
        return toResult({
          dispatched: true,
          taskId,
          agentId: target.agentId,
          candidates: capable.length,
          message: `已派发 ${taskId} 给 ${target.agentId} (${target.name})，共 ${capable.length} 个合格 Agent`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── agent_hub_review ──────────────────────────────────────────────────
  server.tool(
    "agent_hub_review",
    "## 功能：审核 Agent 提交的任务结果，通过/驳回\n## 场景：用于 Agent 提交 PR 后审核代码、通过则标记完成驳回则退回任务池\n## 关键词：审核, review, 批准, 驳回, approve, reject\n## 参数：\n##   - taskId: 任务编号\n##   - verdict: 审核结果。approved=通过, rejected=驳回\n##   - feedback: 审核意见（驳回时必填，说明哪里不满足）\n## 鉴权：PUBLIC — 审核控制接口\n## 风险：READ — 只发消息通知，代码合并由定时任务执行\n## 返回量：微小 ~200B\n## 关联：agent_hub_status 查看完成状态 → 本工具审核 → Agent 收到 task:review → 通过则自动合并",
    {
      taskId:   z.enum(["T-001","T-002","T-003","T-004","T-005","T-006"]).describe("任务编号"),
      verdict:  z.enum(["approved","rejected"]).describe("审核结果"),
      feedback: z.string().optional().describe("审核意见，驳回时必填"),
    },
    async ({ taskId, verdict, feedback }) => {
      try {
        const status = agentHub.status()
        const task = status.tasks.find(t => t.taskId === taskId)

        if (!task) {
          return toResult({ reviewed: false, reason: `任务 ${taskId} 不存在` })
        }
        if (task.status !== "done") {
          return toResult({ reviewed: false, reason: `任务 ${taskId} 状态为 ${task.status}，不是 done` })
        }

        agentHub.reviewTask(taskId, verdict, feedback)

        return toResult({
          reviewed: true,
          taskId,
          verdict,
          feedback: feedback || (verdict === "approved" ? "✅ 通过" : "❌ 驳回"),
          next: verdict === "approved"
            ? `任务完成。Agent 应提 PR 到 master。`
            : `任务已退回任务池。Agent 应根据反馈修改。`,
        })
      } catch (e) { return toError(e) }
    }
  )
}
