import { build } from "esbuild"

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.js",
  external: [],
})

console.log("✅ dist/index.js built")
