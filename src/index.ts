#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerMarketTools }     from "./tools/market.js"
import { registerPublicTools }     from "./tools/public.js"
import { registerAccountTools }    from "./tools/account.js"
import { registerTradingTools }    from "./tools/trading.js"
import { registerAlgoTools }       from "./tools/algo.js"
import { registerFundingTools }    from "./tools/funding.js"
import { registerStatsTools }      from "./tools/stats.js"
import { registerSubAccountTools } from "./tools/subaccount.js"
import { registerFinanceTools }    from "./tools/finance.js"
import { registerOutcomesTools }   from "./tools/outcomes.js"
import { registerBotTools }        from "./tools/bot.js"
import { registerSpreadTools }     from "./tools/spread.js"
import { registerCopyTools }       from "./tools/copy.js"
import { registerSignalTools }      from "./tools/signal.js"
import { registerRfqTools }        from "./tools/rfq.js"
import { registerAffiliateTools }  from "./tools/affiliate.js"
import { registerFiatTools }     from "./tools/fiat.js"
import { registerAgentUtils }    from "./tools/agent-utils.js"
import { registerXLayerWSTools } from "./tools/xlayer-ws.js"
import { registerWsTools } from "./tools/ws.js"
import { registerAgentHubTools } from "./tools/agent-hub.js"
import { startAgentHub } from "./adapters/agent-hub.js"
import { getAuth } from "./tools/shared.js"

async function main() {
  const server = new McpServer({
    name: "hvip-mcp",
    version: "0.2.40",
    description: "hvip MCP Server — 304 工具覆盖 97.7% OKX REST API，含交易/行情/资金/策略/预测市场（非 OKX 官方产品）。仓库: https://github.com/okx-wallet-H/hvip-mcp",
  })
  const auth   = getAuth()

  registerMarketTools(server)
  registerPublicTools(server, auth)
  registerStatsTools(server)
  registerSpreadTools(server, auth)
  registerOutcomesTools(server)
  registerAccountTools(server, auth)
  registerTradingTools(server, auth)
  registerAlgoTools(server, auth)
  registerBotTools(server, auth)
  registerCopyTools(server, auth)
  registerSignalTools(server, auth)
  registerFundingTools(server, auth)
  registerSubAccountTools(server, auth)
  registerFinanceTools(server, auth)
  registerAffiliateTools(server, auth)
  registerFiatTools(server, auth)
  registerRfqTools(server, auth)
  registerAgentUtils(server, auth)

  registerXLayerWSTools(server)

  registerWsTools(server)

  registerAgentHubTools(server)
  startAgentHub(parseInt(process.env.WS_AGENT_PORT || "9321"))

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
