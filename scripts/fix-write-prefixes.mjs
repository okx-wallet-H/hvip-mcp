import { readFileSync, writeFileSync } from "node:fs"

const oldPrefixes = `"okx_one_click_", "okx_easy_convert",
    "agent_quick_trade",
  ]`

const newPrefixes = `"okx_one_click_", "okx_easy_convert",
    "okx_mass_cancel", "okx_subaccount_set_",
    "okx_event_place_", "okx_event_cancel_", "okx_event_amend_",
    "okx_predictions_place_", "okx_predictions_cancel_",
    "okx_predictions_split", "okx_predictions_merge",
    "agent_quick_trade",
  ]`

for (const fp of ["src/tools/shared.ts", "scripts/migrate-register-tool.mjs"]) {
  let src = readFileSync(fp, "utf8")
  if (src.includes(oldPrefixes)) {
    src = src.replace(oldPrefixes, newPrefixes)
    writeFileSync(fp, src, "utf8")
    console.log(fp + ": updated writePrefixes")
  } else {
    console.log(fp + ": oldPrefixes NOT FOUND")
  }
}
