import { readFileSync, writeFileSync } from "node:fs"

let src = readFileSync("src/tools/shared.ts", "utf8")
const oldStart = 'const readSpecials = ['
const oldEnd = ']'

// Find readSpecials array
const idx = src.indexOf(oldStart)
if (idx < 0) { console.log("NOT FOUND"); process.exit(1) }

// Find the closing bracket
let depth = 0
let end = idx
for (let i = idx; i < src.length; i++) {
  if (src[i] === '[') depth++
  if (src[i] === ']') { depth--; if (depth === 0) { end = i + 1; break } }
}

const newBlock = `const readSpecials = [
    "agent_simulate_order", "okx_preflight_check", "okx_agent_feedback",
    "agent_catalog", "agent_catalog_detail", "agent_hub_status",
    "agent_hub_dispatch", "agent_hub_review", "agent_room_send", "agent_room_view",
    "okx_ws_subscribe", "okx_ws_subscribe_private", "okx_ws_events", "okx_ws_status", "okx_ws_close",
    "okx_predictions_ws_subscribe", "okx_predictions_ws_unsubscribe",
    "okx_predictions_ws_events", "okx_predictions_ws_status",
    "xlayer_subscribe", "xlayer_get_events", "xlayer_unsubscribe",
    "codegraph_status", "codegraph_query",
    "agent_get_preference", "agent_set_preference",
    "agent_simulate_transfer", "agent_read_only_trade",
    "okx_event_instruments",
  ]`

src = src.slice(0, idx) + newBlock + src.slice(end)
writeFileSync("src/tools/shared.ts", src, "utf8")
console.log("Updated readSpecials")

// Verify: count entries
const matches = newBlock.match(/"([^"]+)"/g)
console.log(`readSpecials entries: ${matches ? matches.length : 0}`)
