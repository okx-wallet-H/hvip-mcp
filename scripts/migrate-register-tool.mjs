/**
 * Migrate server.tool() → registerTool() across all tool modules.
 * Handles: "desc", `desc` (backtick), and single-line server.tool("NAME", patterns.
 *
 * Usage: node scripts/migrate-register-tool.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, "..", "src", "tools")

// ── classifyRisk (same as shared.ts) ─────────────────────────────────────────

function classifyRisk(toolName) {
  const admin = ["okx_set_account_mode", "okx_set_position_mode", "okx_set_settle_currency"]
  if (admin.includes(toolName)) return "ADMIN"

  const fund = ["okx_withdrawal"]
  if (fund.some(p => toolName.startsWith(p))) return "FUND_TRANSFER"

  const writePrefixes = [
    "okx_place_", "okx_cancel_", "okx_amend_", "okx_create_",
    "okx_stop_", "okx_close_", "okx_batch_", "okx_set_",
    "okx_transfer", "okx_borrow", "okx_repay",
    "okx_convert_trade", "okx_preset_", "okx_activate_",
    "okx_move_", "okx_copy_", "okx_first_",
    "okx_one_click_", "okx_easy_convert",
    "agent_quick_trade",
  ]
  if (writePrefixes.some(p => toolName.startsWith(p))) return "WRITE"

  const readSpecials = [
    "agent_simulate_order", "okx_preflight_check", "okx_agent_feedback",
    "agent_catalog", "agent_catalog_detail", "agent_hub_status",
    "agent_hub_dispatch", "agent_hub_review", "agent_room_send", "agent_room_view",
    "okx_ws_subscribe", "okx_ws_subscribe_private", "okx_ws_events", "okx_ws_status", "okx_ws_close",
    "okx_predictions_ws_subscribe", "okx_predictions_ws_unsubscribe",
    "okx_predictions_ws_events", "okx_predictions_ws_status",
    "codegraph_status", "codegraph_query",
    "xlayer_subscribe", "xlayer_get_events", "xlayer_unsubscribe",
    "agent_get_preference", "agent_set_preference",
    "agent_simulate_transfer", "agent_read_only_trade",
    "okx_event_instruments",
  ]
  if (readSpecials.includes(toolName)) return "READ"

  if (toolName.startsWith("xlayer_call")) return "WRITE"

  return "READ"
}

// ── Core: extract first two string args from a server.tool() call ──────────

/**
 * Given source code starting at "server.tool", extract:
 *   { toolName, descQuote: '"' | '`', description, matchLen }
 *
 * Handles:
 *   server.tool("NAME",                     ← name on same line
 *   server.tool(\n    "NAME",               ← name on next line
 *   "...description..."                     ← double-quoted desc
 *   `...description...`                     ← backtick desc (has `## 功能:` etc)
 *
 * Returns null if extraction fails.
 */
function extractToolCall(src, pos) {
  // After "server.tool", skip optional whitespace and optional "("
  const after = src.slice(pos)
  const openMatch = after.match(/^server\.tool\(\s*/)
  if (!openMatch) return null
  let i = openMatch[0].length

  // Skip whitespace/newlines
  while (i < after.length && /\s/.test(after[i])) i++

  // Read first string arg (tool name) — must be double-quoted
  if (after[i] !== '"') return null
  const nameEnd = findStringEnd(after, i)
  if (nameEnd < 0) return null
  const toolName = JSON.parse(after.slice(i, nameEnd + 1))
  i = nameEnd + 1

  // Skip comma + whitespace/newlines
  while (i < after.length && /[\s,]/.test(after[i])) i++

  // Read second string arg (description) — can be "..." or `...`
  let descQuote = after[i]
  if (descQuote !== '"' && descQuote !== '`') return null
  const descEnd = findStringEnd(after, i)
  if (descEnd < 0) return null
  const descRaw = after.slice(i, descEnd + 1)
  i = descEnd + 1

  // Skip comma after description (to confirm this is the arg boundary)
  let j = i
  while (j < after.length && /\s/.test(after[j])) j++
  if (after[j] !== ',') return null // no comma = not at the right position

  return { toolName, descQuote, descRaw, matchLen: j } // len up to and including the comma
}

function findStringEnd(s, start) {
  const quote = s[start]
  let i = start + 1
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue } // escaped char
    if (s[i] === quote) return i
    i++
  }
  return -1
}

// ── Convert a single file ───────────────────────────────────────────────────

function convertFile(fp) {
  let src = readFileSync(fp, "utf8")
  let toolCount = 0

  // Process from end to start so positions don't shift
  const replacements = []
  let pos = 0
  while (pos < src.length) {
    const idx = src.indexOf("server.tool(", pos)
    if (idx < 0) break

    // Skip if inside registerTool definition (shared.ts)
    if (src.slice(Math.max(0, idx - 50), idx).includes("export function registerTool")) {
      pos = idx + 12
      continue
    }

    const extracted = extractToolCall(src, idx)
    if (!extracted) {
      pos = idx + 12
      continue
    }

    const { toolName, descRaw, matchLen } = extracted
    const risk = classifyRisk(toolName)

    // Build replacement: registerTool(server, "NAME", "LEVEL", DESC,
    // We need to find the exact match including the leading whitespace
    // server.tool(  →  registerTool(
    const newPrefix = "registerTool("
    const before = src.slice(0, idx)
    const matched = src.slice(idx, idx + matchLen)

    // Replace server.tool( → registerTool(, then insert args
    let newCall = matched.replace("server.tool(", newPrefix)
    // After registerTool(, insert: server, "NAME", "LEVEL",
    // The matched text includes: registerTool(\n...  "NAME",\n...  DESC,
    // We need to insert server, before "NAME" and "LEVEL", after "NAME"
    const nameRe = new RegExp(`"${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
    newCall = newCall.replace(nameRe, `server,\n    "${toolName}",\n    "${risk}"`)

    replacements.push({ start: idx, end: idx + matchLen, replacement: newCall })
    toolCount++
    pos = idx + matchLen
  }

  // Apply replacements from end to start
  for (const r of replacements.reverse()) {
    src = src.slice(0, r.start) + r.replacement + src.slice(r.end)
  }

  if (toolCount > 0) {
    // Add registerTool to imports from shared.js
    src = src.replace(
      /import \{([^}]*)\} from "([^"]*shared\.js)"/g,
      (m, imports, path) => {
        if (imports.includes("registerTool")) return m
        return `import {${imports}, registerTool} from "${path}"`
      }
    )

    writeFileSync(fp, src, "utf8")
  }

  return toolCount
}

// ── Main ─────────────────────────────────────────────────────────────────────

let totalTools = 0
const results = []

for (const f of readdirSync(dir).filter(x => x.endsWith(".ts"))) {
  if (f === "shared.ts") continue
  const fp = join(dir, f)
  const n = convertFile(fp)
  if (n > 0) {
    results.push(`${f}: ${n} tools`)
    totalTools += n
  }
}

// Check remaining
let remaining = 0
for (const f of readdirSync(dir).filter(x => x.endsWith(".ts"))) {
  const src = readFileSync(join(dir, f), "utf8")
  const m = src.match(/server\.tool\(/g)
  if (m) {
    // Exclude registerTool calls in shared.ts and import statements
    const valid = m.filter(() => true).length
    if (f === "shared.ts") {
      // Expected: registerTool itself calls server.tool()
      console.log(`  (shared.ts: ${m.length} in registerTool definition)`)
    } else {
      remaining += m.length
      console.log(`  WARNING: ${f}: ${m.length} server.tool() NOT converted!`)
    }
  }
}

console.log(`\nConverted: ${totalTools} tools across ${results.length} files`)
if (remaining === 0) console.log("All server.tool() calls converted successfully!")
else console.log(`Remaining: ${remaining} unconverted (should be 0)`)
results.forEach(r => console.log("  " + r))
