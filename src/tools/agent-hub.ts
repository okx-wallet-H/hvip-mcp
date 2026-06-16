import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { agentHub } from "../adapters/agent-hub.js"
import { toResult, toError , registerTool} from "./shared.js"

export function registerAgentHubTools(server: McpServer): void {

  // ── agent_hub_status ──────────────────────────────────────────────────
  registerTool(
    server,
    "agent_hub_status",
    "READ",
    "CAT:[系统] | → 请先调用 agent_catalog",
    {},
    async () => {
      try {
        return toResult(agentHub.status())
      } catch (e) { return toError(e) }
    }
  )

  // ── agent_hub_dispatch ──────────────────────────────────────────────────
  registerTool(
    server,
    "agent_hub_dispatch",
    "READ",
    "CAT:[系统] | → 请先调用 agent_catalog",
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
  registerTool(
    server,
    "agent_hub_review",
    "READ",
    "CAT:[系统] | → 请先调用 agent_catalog",
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
  registerTool(
    server,
    "agent_room_send",
    "READ",
    "CAT:[系统] | → 请先调用 agent_catalog",
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
  registerTool(
    server,
    "agent_room_view",
    "READ",
    "CAT:[系统] | → 请先调用 agent_catalog",
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
