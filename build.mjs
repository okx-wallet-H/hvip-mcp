import { build } from "esbuild"
import { readFileSync, writeFileSync } from "fs"

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
