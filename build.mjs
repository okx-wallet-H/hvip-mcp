import { build } from "esbuild"
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs"
import { join, dirname } from "path"

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/index.js built")

await build({
  entryPoints: ["src/hub-server.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/hub-server.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/hub-server.js built")

await build({
  entryPoints: ["src/hub-worker.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/hub-worker.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/hub-worker.js built")

await build({
  entryPoints: ["src/hub-worker-v2.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/hub-worker-v2.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/hub-worker-v2.js built")

await build({
  entryPoints: ["src/chronos-dispatcher.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/chronos-dispatcher.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/chronos-dispatcher.js built")

await build({
  entryPoints: ["src/ai-trader.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/ai-trader.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/ai-trader.js built")

await build({
  entryPoints: ["src/mcp-gateway.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/mcp-gateway.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
})

console.log("✅ dist/mcp-gateway.js built")

// ── Copy web assets to dist/ ──
const webFiles = [
  "index.html",
]
const distWeb = join("dist", "web")
if (!existsSync(distWeb)) mkdirSync(distWeb, { recursive: true })
for (const f of webFiles) {
  const src = join("src", "web", f)
  const dst = join(distWeb, f)
  if (existsSync(src)) {
    writeFileSync(dst, readFileSync(src))
    console.log(`✅ dist/web/${f} copied`)
  } else {
    console.log(`⚠️  src/web/${f} not found, skipped`)
  }
}

// ── Copy tool-name-map.json to dist/ ──
const mapSrc = join("src", "tools", "tool-name-map.json")
const mapDst = join("dist", "tools", "tool-name-map.json")
if (existsSync(mapSrc)) {
  if (!existsSync(join("dist", "tools"))) mkdirSync(join("dist", "tools"), { recursive: true })
  writeFileSync(mapDst, readFileSync(mapSrc))
  console.log("✅ dist/tools/tool-name-map.json copied")
}

// ── Copy chat-app to dist/ ──
const chatAppExclude = new Set(["_test.js", "_test2.js", "fix-final.js", "fix-line121.js", "_clean.js", "rebuild.js"])
const chatAppDir = join("chat-app")
const distChatApp = join("dist", "chat-app")
if (existsSync(chatAppDir)) {
  if (!existsSync(distChatApp)) mkdirSync(distChatApp, { recursive: true })
  const chatFiles = readdirSync(chatAppDir)
  for (const f of chatFiles) {
    if (chatAppExclude.has(f)) { console.log(`⏭️  dist/chat-app/${f} skipped (temp script)`); continue }
    const src = join(chatAppDir, f)
    const dst = join(distChatApp, f)
    if (statSync(src).isFile()) {
      writeFileSync(dst, readFileSync(src))
      console.log(`✅ dist/chat-app/${f} copied`)
    }
  }
}
