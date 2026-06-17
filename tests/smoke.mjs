/**
 * hvip 烟雾测试 — Playwright 验证 Dashboard + Chat UI + API
 *
 * 用法:
 *   node tests/smoke.mjs
 *
 * CI:
 *   npm run build && node dist/hub-server.js --port 9329 --web-port 3009 &
 *   sleep 3 && node tests/smoke.mjs
 */

import { chromium } from "playwright"

const HUB = process.env.SMOKE_HUB || "http://127.0.0.1:3009"
const MCP = process.env.SMOKE_MCP || "http://127.0.0.1:3002"

let passed = 0
let failed = 0
const failures = []

async function check(label, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✅ ${label}`)
  } catch (e) {
    failed++
    failures.push(`${label}: ${e.message}`)
    console.log(`  ❌ ${label}: ${e.message}`)
  }
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  // ═══════════════════════════════════════════════════════
  // Hub Dashboard
  // ═══════════════════════════════════════════════════════
  console.log("\n── Hub Dashboard ──")
  await check("页面可加载 (标题非空)", async () => {
    await page.goto(HUB, { waitUntil: "networkidle", timeout: 15000 })
    const t = await page.title()
    if (!t) throw new Error("title 为空")
  })

  await check("仪表盘标题包含 'Agent Hub'", async () => {
    const h1 = await page.$("h1,h2")
    const text = await h1?.textContent()
    if (!text?.includes("Agent Hub")) throw new Error("仪表盘标题异常: " + text)
  })

  await check("任务列表渲染 (>0 个 .card)", async () => {
    const n = await page.$$eval("[class*=card]", els => els.length)
    if (n === 0) throw new Error("没有卡片元素")
  })

  await check("至少 1 个 button", async () => {
    const n = await page.$$eval("button", els => els.length)
    if (n === 0) throw new Error("没有按钮")
  })

  await check("/api/status 返回 agentCount", async () => {
    const r = await page.evaluate(() => fetch("/api/status").then(r => r.json()))
    if (typeof r.agentCount !== "number") throw new Error("status 接口异常: " + JSON.stringify(r))
  })

  await check("/health 返回 200", async () => {
    const r = await page.evaluate(() => fetch("/health").then(r => r.json()))
    if (r.status !== "ok") throw new Error("health 异常: " + JSON.stringify(r))
  })

  // ═══════════════════════════════════════════════════════
  // MCP Chat UI
  // ═══════════════════════════════════════════════════════
  console.log("\n── MCP Chat UI ──")
  await check("页面可加载 (标题 hvip-chat)", async () => {
    await page.goto(MCP, { waitUntil: "networkidle", timeout: 15000 })
    const t = await page.title()
    if (!t.includes("hvip")) throw new Error("title 不是 hvip-chat: " + t)
  })

  await check("Chat 界面至少有 5 个按钮", async () => {
    const n = await page.$$eval("button", els => els.length)
    if (n < 5) throw new Error("按钮太少: " + n)
  })

  await check("有快捷问题 (至少 1 个聊天提示)", async () => {
    const tips = await page.evaluate(() => {
      return document.body.innerText.includes("BTC") || document.body.innerText.includes("行情")
    })
    if (!tips) throw new Error("没有快捷问题/提示")
  })

  await check("/health 返回 mode=full", async () => {
    const r = await page.evaluate(() => fetch("/health").then(r => r.json()))
    if (!r.mode) throw new Error("health 异常: " + JSON.stringify(r))
  })

  await check("MCP 服务器未崩溃 (uptime > 0)", async () => {
    const r = await page.evaluate(() => fetch("/health").then(r => r.json()))
    if (!r.uptime || r.uptime < 1) throw new Error("服务器刚崩了？uptime=" + JSON.stringify(r))
    console.log("    (uptime: " + r.uptime.toFixed(0) + "s)")
  })

  // 截图
  await page.goto(HUB, { waitUntil: "networkidle" })
  await page.screenshot({ path: "docs/smoke-hub.png", fullPage: true })
  console.log("  📸 docs/smoke-hub.png")

  await page.goto(MCP, { waitUntil: "networkidle" })
  await page.screenshot({ path: "docs/smoke-chat.png", fullPage: true })
  console.log("  📸 docs/smoke-chat.png")

  await browser.close()

  // ── 结果 ──
  console.log(`\n───────────────`)
  console.log(`  通过: ${passed}  失败: ${failed}`)
  if (failures.length > 0) {
    console.log(`  失败项:`)
    for (const f of failures) console.log(`    - ${f}`)
  }
  console.log(`───────────────\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main()
