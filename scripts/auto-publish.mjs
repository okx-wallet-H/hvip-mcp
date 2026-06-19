/**
 * scripts/auto-publish.mjs — CI 全绿自动发版 (P3-3)
 * ==================================================
 * 检查本地版本是否高于 npm，是则自动 build + publish。
 *
 * 由 Chronos 每 30 分钟巡检调用一次。
 * 也可以手动: node scripts/auto-publish.mjs
 */

import { execSync } from "node:child_process"

const PKG = "hvip-mcp-server"

async function main() {
  // 1. Check we're on master
  const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim()
  if (branch !== "master") {
    console.log(`[Publish] 跳过 — 当前分支 ${branch}，非 master`)
    return
  }

  // 2. Get local version
  const { version: localVersion } = await import("../package.json", { with: { type: "json" } })

  // 3. Get npm version
  let npmVersion = "0.0.0"
  try {
    npmVersion = execSync(`npm view ${PKG} version`, { encoding: "utf-8", timeout: 15000 }).trim()
  } catch {
    console.log("[Publish] npm 查询失败，跳过")
    return
  }

  // 4. Compare versions
  if (localVersion === npmVersion) {
    console.log(`[Publish] ✅ 已是最新: v${localVersion}`)
    return
  }

  // Parse versions
  const [lMaj, lMin, lPat] = localVersion.split(".").map(Number)
  const [nMaj, nMin, nPat] = npmVersion.split(".").map(Number)
  const localNum = lMaj * 10000 + lMin * 100 + lPat
  const npmNum = nMaj * 10000 + nMin * 100 + nPat

  if (localNum <= npmNum) {
    console.log(`[Publish] npm v${npmVersion} >= 本地 v${localVersion}，无需发布`)
    return
  }

  // 5. Build + Publish
  console.log(`[Publish] 🚀 本地 v${localVersion} > npm v${npmVersion}，开始发布...`)

  try {
    console.log("[Publish] Building...")
    execSync("npm run build", { encoding: "utf-8", timeout: 120000, stdio: "inherit" })

    console.log("[Publish] Publishing...")
    execSync("npm publish", { encoding: "utf-8", timeout: 120000, stdio: "inherit" })

    console.log(`[Publish] ✅ 已发布 v${localVersion} → https://www.npmjs.com/package/${PKG}`)
  } catch (e) {
    console.error(`[Publish] ❌ 发布失败: ${e.message}`)
  }
}

main().catch(e => {
  console.error(`[Publish] Fatal: ${e.message}`)
  process.exit(1)
})
