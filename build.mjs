import { build } from "esbuild"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
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

// ── Copy web assets to dist/ ──
const webFiles = [
  "dashboard.html",
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
