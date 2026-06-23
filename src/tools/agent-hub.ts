import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { agentHub } from "../adapters/agent-hub.js"
import { toResult, toError , registerTool} from "./shared.js"

export function registerAgentHubTools(server: McpServer): void {

  // ── agent_hub_status ──────────────────────────────────────────────────
  registerTool(
    server,
    "sys_hub_status",
    "READ",
    "[D:System] Agent Hub 集群状态：在线Agent数+任务队列+房间数 | 无需参数 | 派任务用 sys_hub_dispatch → 看协作 sys_room_view",
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
    "sys_hub_dispatch",
    "READ",
    "[D:System] 派发任务到指定Agent或自动匹配空闲Agent | taskId(T-001~T-006), agentId? | 先 sys_hub_status 看谁在线 → sys_room_view 看进度",
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
    "sys_hub_review",
    "READ",
    "[D:System] 审核Agent提交的任务结果：通过/驳回 | taskId, verdict(approved/rejected), feedback? | 驳回→Agent在房间收到反馈 → sys_room_view 看讨论",
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
    "sys_room_send",
    "READ",
    "[D:System] 向指定房间发送消息 | roomId(#lobby/#review/#task-xx), text | sys_room_view 看历史 → sys_hub_status 看全局",
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
    "sys_room_view",
    "READ",
    "[D:System] 查看房间消息历史或列出所有房间 | roomId?(不填列全部), limit? | sys_room_send 发消息 → sys_hub_status 看集群状态",
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
