import { readFileSync, writeFileSync } from "node:fs"

// Cleanly replace the SQLite init block in each file
const files = [
  { path: "src/adapters/hub-persistence.ts", anchor: "// ── DB 类型" },
  { path: "src/adapters/hub-memory.ts", anchor: "// ── 类型" },
  { path: "src/adapters/hub-registry.ts", anchor: "export interface MCPPlugin" },
]

for (const { path, anchor } of files) {
  let s = readFileSync(path, "utf8")
  const idx = s.indexOf(anchor)
  if (idx < 0) { console.log(path + ": anchor not found"); continue }

  // Find the start of the last function/var block before the anchor
  // This is roughly: everything from the last "let DatabaseSync" or "function ensure" to the anchor
  const beforeBlock = s.slice(0, idx)
  // Find the last occurrence of "let DatabaseSync" or "function ready"
  const lastVar = Math.max(
    beforeBlock.lastIndexOf("let DatabaseSync"),
    beforeBlock.lastIndexOf("function ready()"),
  )
  if (lastVar < 0) { console.log(path + ": var not found"); continue }

  // Remove everything from lastVar to anchor
  s = s.slice(0, lastVar) + "import { isSqliteAvailable, openDB, ensureDir } from \"./shared-sqlite.js\"\r\n\r\n" + s.slice(idx)

  // Replace ensure() → isSqliteAvailable()
  s = s.replace(/if \(!ensure\(\)\)/g, "if (!isSqliteAvailable())")

  // Replace new DatabaseSync → openDB
  s = s.replace(/this\.db = new DatabaseSync\(this\.dbPath, \{ create: true \}\)/g, "this.db = openDB(this.dbPath, { create: true })")

  writeFileSync(path, s, "utf8")
  console.log(path + ": cleaned")
}

console.log("Done")
