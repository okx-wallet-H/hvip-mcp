/**
 * Fix misclassified accessLevel values in outcomes.ts.
 * These tools weren't matched by writePrefixes because they use
 * "okx_event_*" / "okx_predictions_*" patterns.
 */
import { readFileSync, writeFileSync } from "node:fs"

const fixes = [
  // T-005 event contract trading
  ["okx_event_place_order",        "WRITE"],
  ["okx_event_cancel_order",       "WRITE"],
  ["okx_event_amend_order",        "WRITE"],
  // Predictions order management
  ["okx_predictions_place_order",  "WRITE"],
  ["okx_predictions_cancel_order", "WRITE"],
  ["okx_predictions_cancel_all",   "WRITE"],
  // Predictions position operations
  ["okx_predictions_split",        "WRITE"],
  ["okx_predictions_merge",        "WRITE"],
  // Redeem = fund transfer
  ["okx_predictions_redeem",       "FUND_TRANSFER"],
]

let src = readFileSync("src/tools/outcomes.ts", "utf8")

for (const [name, correctLevel] of fixes) {
  const re = new RegExp(
    `(registerTool\\(\\s*server,\\s*\\n\\s*"${name}",\\s*\\n\\s*)"READ"`,
    "g"
  )
  const before = src
  src = src.replace(re, `$1"${correctLevel}"`)
  if (src !== before) {
    console.log(`  ${name}: READ → ${correctLevel}`)
  }
}

writeFileSync("src/tools/outcomes.ts", src, "utf8")

// Also update the migration script's classifyRisk for future use
let ms = readFileSync("scripts/migrate-register-tool.mjs", "utf8")

// Add okx_event_* and okx_predictions_* to writePrefixes
const oldWrite = `const writePrefixes = [
    "okx_place_", "okx_cancel_", "okx_amend_", "okx_create_",
    "okx_stop_", "okx_close_", "okx_batch_", "okx_set_",
    "okx_transfer", "okx_borrow", "okx_repay",
    "okx_convert_trade", "okx_preset_", "okx_activate_",
    "okx_move_", "okx_copy_", "okx_first_",
    "okx_one_click_", "okx_easy_convert",
    "agent_quick_trade",
  ]`
const newWrite = `const writePrefixes = [
    "okx_place_", "okx_cancel_", "okx_amend_", "okx_create_",
    "okx_stop_", "okx_close_", "okx_batch_", "okx_set_",
    "okx_transfer", "okx_borrow", "okx_repay",
    "okx_convert_trade", "okx_preset_", "okx_activate_",
    "okx_move_", "okx_copy_", "okx_first_",
    "okx_one_click_", "okx_easy_convert",
    "okx_event_place_", "okx_event_cancel_", "okx_event_amend_",
    "okx_predictions_place_", "okx_predictions_cancel_",
    "okx_predictions_split", "okx_predictions_merge",
    "okx_predictions_redeem",
    "agent_quick_trade",
  ]`
ms = ms.replace(oldWrite, newWrite)

// Also update shared.ts writePrefixes
let ss = readFileSync("src/tools/shared.ts", "utf8")
ss = ss.replace(oldWrite, newWrite)
writeFileSync("src/tools/shared.ts", ss, "utf8")

// Add FUND_TRANSFER for predictions redeem
const oldFund = 'const fund = ["okx_withdrawal"]'
const newFund = 'const fund = ["okx_withdrawal", "okx_predictions_redeem"]'
ms = ms.replace(oldFund, newFund)
ss = ss.replace(oldFund, newFund)
writeFileSync("src/tools/shared.ts", ss, "utf8")
writeFileSync("scripts/migrate-register-tool.mjs", ms, "utf8")

console.log("\nUpdated shared.ts, migration script, and outcomes.ts")
