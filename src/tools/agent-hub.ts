import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { agentHub } from "../adapters/agent-hub.js"
import { toResult, toError } from "./shared.js"

export function registerAgentHubTools(server: McpServer): void {

  // ── agent_hub_status ──────────────────────────────────────────────────
  server.tool(
    "agent_hub_status",
    "CAT:[系统] | ## 功能：查看 Agent Hub 全景：所有在线 Agent、任务分配、房间消息\n## 场景：用于巡检 Agent 集群健康状况、了解哪些任务在推进、哪个 Agent 空闲可派活\n## 关键词：Agent Hub, 集群状态, 任务进度, 在线Agent, 调度面板, 房间\n## 参数：无\n## 鉴权：PUBLIC — Agent Hub 内部接口\n## 风险：READ — 只读状态查询\n## 返回量：微小 ~2KB\n## 关联：本工具查看全局 → agent_hub_dispatch 派发任务 → agent_room_send 发消息",
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
    "CAT:[系统] | ## 功能：向指定 Agent 或全体在线 Agent 派发任务\n## 场景：用于手动将任务池中的工单分发给空闲 Agent、补充自动派发未覆盖的任务\n## 关键词：派发, dispatch, 任务分配, 调度, assign\n## 参数：\n##   - taskId: 任务编号\n##   - agentId: 目标 Agent ID（选填，不填则找第一个匹配的）\n## 鉴权：PUBLIC — 调度控制接口\n## 风险：READ — 只派发消息，不修改代码\n## 返回量：微小 ~200B\n## 关联：agent_hub_status 查看 Agent 状态 → 本工具派发 → Agent 收到 task:dispatch",
    {
      taskId:  z.enum(["T-001","T-002","T-003","T-004","T-005","T-006"]).describe("任务编号"),
      agentId: z.string().optional().describe("目标 Agent ID。不填则自动匹配有对应技能的 Agent"),
    },
    async ({ taskId, agentId }) => {
      try {
        const status = agentHub.status()

        if (agentId) {
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
    "CAT:[系统] | ## 功能：审核 Agent 提交的任务结果，通过/驳回，自动通知对应任务房间\n## 场景：审核员审完代码后发结果，Agent 在房间实时收到反馈\n## 关键词：审核, review, 批准, 驳回, approve, reject, 房间通知\n## 参数：\n##   - taskId: 任务编号\n##   - verdict: 审核结果。approved=通过, rejected=驳回\n##   - feedback: 审核意见（驳回时必填）\n## 鉴权：PUBLIC — 审核控制接口\n## 风险：READ — 发消息通知，代码的合并由定时任务执行\n## 返回量：微小 ~200B\n## 关联：审核不通过 → agent_room_send 发房间消息 → Agent 改代码",
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
          roomNotice: `审核结果已推送到 #task-${taskId} 房间`,
          next: verdict === "approved"
            ? `任务完成。`
            : `任务退回。Agent 在 #task-${taskId} 房间查看反馈。`,
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── agent_room_send ──────────────────────────────────────────────────
  server.tool(
    "agent_room_send",
    "CAT:[系统] | ## 功能：向指定房间发送消息，所有房间成员实时收到\n## 场景：审核员给 Agent 发反馈、在任务房间协调、向所有人广播\n## 关键词：房间消息, room, 发送, 通知, 广播\n## 参数：\n##   - roomId: 房间ID。#lobby / #review / #task-T-XXX\n##   - text: 消息内容\n## 鉴权：PUBLIC\n## 风险：READ — 只发消息\n## 返回量：微小 ~200B\n## 关联：审核不通过 → 本工具发 #task-T-XXX → Agent 收到",
    {
      roomId: z.string().describe("房间ID。#lobby / #review / #task-T-003"),
      text:   z.string().describe("消息内容"),
    },
    async ({ roomId, text }) => {
      try {
        agentHub.sendToRoom(roomId, "reviewer", text)
        return toResult({
          sent: true,
          roomId,
          text,
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )

  // ── agent_room_view ──────────────────────────────────────────────────
  server.tool(
    "agent_room_view",
    "CAT:[系统] | ## 功能：查看房间列表或指定房间的消息历史\n## 场景：检查哪些房间活跃、读取历史消息、看谁在房间里\n## 关键词：房间, room, 消息历史, 在线成员\n## 参数：\n##   - roomId: 房间ID（选填，不填列出所有房间）\n##   - limit: 消息条数，默认 30\n## 鉴权：PUBLIC\n## 风险：READ — 只读\n## 返回量：微小 ~3KB\n## 关联：agent_room_send 发消息 → 本工具查看历史",
    {
      roomId: z.string().optional().describe("房间ID，不填列出所有"),
      limit:  z.number().int().min(1).max(200).optional().describe("消息条数，默认30"),
    },
    async ({ roomId, limit }) => {
      try {
        if (roomId) {
          const msgs = agentHub.getRoomHistory(roomId, limit || 30)
          return toResult({
            roomId,
            messageCount: msgs.length,
            messages: msgs,
            tsIso: new Date().toISOString(),
          })
        }

        const rooms = agentHub.getRooms()
        return toResult({
          rooms,
          count: rooms.length,
          hint: "传 roomId 查看具体房间消息。frequent: #lobby #review #task-T-003",
          tsIso: new Date().toISOString(),
        })
      } catch (e) { return toError(e) }
    }
  )
}
