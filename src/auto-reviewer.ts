/**
 * Auto Reviewer — AI 代码审查官 (P3-1)
 * ======================================
 * 监听 task:done → 自动审查代码 → 通过则 PR → CI 绿自动 merge
 *
 * 工作流:
 *   1. WebSocket 监听 task:done (code 类任务)
 *   2. AgentLoop 审查改动: 正确性 + 安全 + 性能
 *   3. 通过 → gh pr create → 等 CI → merge
 *   4. 不通过 → 创建 fix 任务回队列
 *
 * PM2:
 *   pm2 start dist/auto-reviewer.js --name auto-reviewer
 */

import { WebSocket } from "ws"
import { execSync } from "node:child_process"
import { AgentLoop } from "./adapters/ai-sdk.js"
import { logger } from "./utils/logger.js"

const HUB_URL = process.env.HUB_URL || "ws://127.0.0.1:9321"
const AGENT_ID = "auto-reviewer"
const AGENT_NAME = "Themis·审查官"
const REVIEW_INTERVAL_MS = parseInt(process.env.REVIEW_INTERVAL || "30000", 10)

const log = logger("Reviewer")
const agent = new AgentLoop()

let ws: WebSocket
let heartbeatTimer: ReturnType<typeof setInterval>

// ═══════════════════════════════════════════════════════════
// Review Logic
// ═══════════════════════════════════════════════════════════

interface ReviewResult {
  passed: boolean
  score: number        // 0-100
  summary: string
  issues: Array<{ severity: "critical" | "high" | "medium" | "low"; file: string; description: string }>
  recommendation: "merge" | "fix" | "manual"
}

async function reviewTask(taskId: string, result: string, branch?: string): Promise<ReviewResult> {
  // Get the diff
  let diff = ""
  try {
    diff = execSync("git diff HEAD~1 --stat", { encoding: "utf-8", timeout: 10000 })
  } catch {
    // If no previous commit, check working tree
    try {
      diff = execSync("git diff --stat", { encoding: "utf-8", timeout: 10000 })
    } catch {}
  }

  const reviewPrompt = `你是一个资深代码审查员。审查这个任务的产出。

任务ID: ${taskId}
${branch ? `分支: ${branch}` : ""}

提交信息/结果:
${result.slice(0, 3000)}

文件变更:
${diff.slice(0, 2000)}

审查维度:
1. 正确性: 逻辑对吗？
2. 安全性: 有注入/泄露/权限问题吗？
3. 性能: 有明显的浪费吗？
4. 规范: 符合项目 CLAUDE.md 的代码纪律吗？

返回 JSON:
{
  "passed": true/false,
  "score": 0-100,
  "summary": "一句话总结",
  "issues": [
    { "severity": "critical|high|medium|low", "file": "路径", "description": "问题描述" }
  ],
  "recommendation": "merge|fix|manual"
}

评分标准:
- 90+: 代码质量高，建议直接合并
- 70-89: 有小问题但可以合并后修
- 50-69: 需要修复后重新提交
- <50: 有大问题，需要人工介入

只需返回 JSON，不要其他文字。`

  try {
    const reviewResult = await agent.run(reviewPrompt, {}, {
      model: "claude-sonnet-4-6",
      maxTokens: 800,
      maxSteps: 1,
      temperature: 0.1,
    })

    const json = reviewResult.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) {
      return { passed: false, score: 0, summary: "AI 审查失败：无法解析结果", issues: [], recommendation: "manual" }
    }
    return JSON.parse(json)
  } catch (e: any) {
    log.warn(`审查异常: ${e.message}`)
    return { passed: false, score: 0, summary: `审查异常: ${e.message}`, issues: [], recommendation: "manual" }
  }
}

// ═══════════════════════════════════════════════════════════
// Auto PR + Merge
// ═══════════════════════════════════════════════════════════

async function createAutoPR(taskId: string, branch: string): Promise<string | null> {
  try {
    // Check if branch has commits to push
    const diffCheck = execSync(`git diff origin/master...${branch} --stat`, {
      encoding: "utf-8", timeout: 10000,
    })
    if (!diffCheck.trim()) {
      log.info(`分支 ${branch} 无差异，跳过 PR`)
      return null
    }

    // Push branch
    execSync(`git push origin ${branch}`, { encoding: "utf-8", timeout: 30000 })

    // Create PR via gh CLI
    const prUrl = execSync(
      `gh pr create --base master --head ${branch} --title "Auto: ${taskId} — AI 代码审查通过" --body "## AI 自动审查通过 ✅\n\n任务: ${taskId}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`,
      { encoding: "utf-8", timeout: 30000 },
    ).trim()

    log.info(`✅ PR 已创建: ${prUrl}`)

    // Auto-merge if enabled
    if (process.env.AUTO_MERGE !== "false") {
      try {
        execSync(`gh pr merge ${prUrl} --squash --subject "Auto-merge: ${taskId}"`, {
          encoding: "utf-8", timeout: 60000,
        })
        log.info(`✅ PR 已自动合并: ${prUrl}`)
      } catch (e: any) {
        log.warn(`PR 合并失败（可能需要人工审核）: ${e.message}`)
      }
    }

    return prUrl
  } catch (e: any) {
    log.error(`PR 创建失败: ${e.message}`)
    return null
  }
}

// ═══════════════════════════════════════════════════════════
// WebSocket Client
// ═══════════════════════════════════════════════════════════

async function createFixTask(originalTaskId: string, issues: ReviewResult["issues"]) {
  try {
    const taskId = `FIX-${originalTaskId.slice(0, 20)}-${Date.now().toString(36)}`
    const desc = issues.map(i => `[${i.severity}] ${i.file}: ${i.description}`).join("\n")
    await fetch("http://127.0.0.1:3000/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        title: `[Auto-Fix] 修复 ${originalTaskId}`,
        template: "fix-bug",
        params: { errorLog: desc },
      }),
    })
    log.info(`🔧 已创建修复任务: ${taskId}`)
    return taskId
  } catch (e: any) {
    log.warn(`修复任务创建失败: ${e.message}`)
    return null
  }
}

function connect() {
  ws = new WebSocket(HUB_URL)

  ws.on("open", () => {
    log.info(`已连接 Hub，注册为 ${AGENT_NAME}`)
    ws.send(JSON.stringify({
      type: "agent:hello",
      agentId: AGENT_ID,
      name: AGENT_NAME,
      version: "0.5.0",
      capabilities: ["code-review", "auto-merge"],
    }))
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "agent:status" }))
      }
    }, 30000)
  })

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      // Only review code-related tasks
      if (msg.type === "task:completed" && msg.taskId) {
        const isCodeTask = msg.taskId.startsWith("C-") || msg.taskId.startsWith("FIX-") ||
          msg.taskId.startsWith("HEAL-") || (msg.result && msg.result.includes("build"))
        if (!isCodeTask) return

        log.info(`🔍 审查任务: ${msg.taskId}`)

        // Broadcast review start
        ws.send(JSON.stringify({
          type: "task:progress", taskId: msg.taskId,
          delta: `[Themis] 🔍 开始审查 ${msg.taskId}...`,
        }))

        const review = await reviewTask(msg.taskId, msg.result || "", msg.branch)

        // Broadcast review result
        ws.send(JSON.stringify({
          type: "task:tool", taskId: msg.taskId,
          tool: "code-review",
          args: { passed: review.passed, score: review.score, recommendation: review.recommendation },
        }))

        if (review.passed && review.recommendation === "merge" && msg.branch) {
          const prUrl = await createAutoPR(msg.taskId, msg.branch)
          ws.send(JSON.stringify({
            type: "task:progress", taskId: msg.taskId,
            delta: `[Themis] ✅ 审查通过 (${review.score}分) ${prUrl ? 'PR: ' + prUrl : ''}`,
          }))
        } else if (!review.passed && review.issues.length > 0) {
          ws.send(JSON.stringify({
            type: "task:progress", taskId: msg.taskId,
            delta: `[Themis] ❌ 审查不通过 (${review.score}分) 发现 ${review.issues.length} 个问题，自动创建修复任务`,
          }))
          await createFixTask(msg.taskId, review.issues)
        } else {
          ws.send(JSON.stringify({
            type: "task:progress", taskId: msg.taskId,
            delta: `[Themis] ⚠️ 需人工审核 (${review.score}分) ${review.summary}`,
          }))
        }
      }
    } catch {
      // Ignore malformed messages
    }
  })

  ws.on("close", () => {
    clearInterval(heartbeatTimer)
    setTimeout(connect, 5000)
  })

  ws.on("error", (e: Error) => { log.error(`WS 错误: ${e.message}`) })
}

// ═══════════════════════════════════════════════════════════
// Periodic scan for un-reviewed tasks
// ═══════════════════════════════════════════════════════════

async function scanPendingReviews() {
  try {
    const resp = await fetch("http://127.0.0.1:3000/api/status")
    const data = await resp.json() as any
    const doneTasks = (data.tasks || []).filter((t: any) =>
      (t.status === "done" || t.status === "reviewed") &&
      (t.taskId.startsWith("C-") || t.taskId.startsWith("FIX-") || t.taskId.startsWith("HEAL-"))
    )

    if (doneTasks.length) {
      log.debug(`扫描到 ${doneTasks.length} 个待审查任务`)
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════

log.info("Auto Reviewer 启动 — 监听代码任务自动审查")
connect()
setInterval(scanPendingReviews, REVIEW_INTERVAL_MS)

process.on("SIGINT", () => { log.info("关闭"); process.exit(0) })
process.on("SIGTERM", () => { log.info("关闭"); process.exit(0) })
