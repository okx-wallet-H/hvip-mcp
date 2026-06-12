const DEFAULT_BASE = "https://api-staging.hwallet.vip"

async function request<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  apiKey: string,
  base: string
): Promise<T> {
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  const p = new URLSearchParams()
  for (const [k, v] of filtered) p.append(k, String(v))
  const query = p.size ? "?" + p.toString() : ""

  const res = await fetch(base + path + query, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const json = await res.json() as { code: string; message?: string; data?: T }
  if (String(json.code) !== "0") throw new Error(`HRails ${json.code}: ${json.message ?? "unknown error"}`)

  return (json.data ?? json) as T
}

export function createHRailsClient(apiKey: string, baseUrl = DEFAULT_BASE) {
  const get = <T>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
    request<T>(path, params, apiKey, baseUrl)

  return {
    health: () => fetch(baseUrl + "/health").then(r => r.json()),

    listEvents: (params?: { pageSize?: number; search?: string; includeMarkets?: boolean }) => {
      const q: Record<string, string | number | boolean | undefined> = {}
      if (params?.pageSize !== undefined) q["pageSize"] = params.pageSize
      if (params?.search !== undefined) q["search"] = params.search
      if (params?.includeMarkets !== undefined) q["includeMarkets"] = params.includeMarkets
      return get<unknown>("/v1/events", q)
    },

    getEvent: (eventId: string) =>
      get<unknown>(`/v1/events/${eventId}`, { includeMarkets: true }),

    listMarkets: (params?: { pageSize?: number }) =>
      get<unknown>("/v1/markets", { pageSize: params?.pageSize }),

    getMarket: (marketId: string) =>
      get<unknown>(`/v1/markets/${marketId}`),

    getTicker: (marketId: string, outcome: "YES" | "NO") =>
      get<unknown>(`/v1/markets/${marketId}/ticker`, { outcome }),

    getOrderbook: (marketId: string, outcome: "YES" | "NO", size?: number) =>
      get<unknown>(`/v1/markets/${marketId}/orderbook`, { outcome, size }),

    getCandles: (marketId: string, outcome: "YES" | "NO", bar?: string, limit?: number) =>
      get<unknown>(`/v1/markets/${marketId}/candles`, { outcome, bar, limit }),

    catalogStatus: () =>
      get<unknown>("/v1/catalog/status"),
  }
}

export type HRailsClient = ReturnType<typeof createHRailsClient>
