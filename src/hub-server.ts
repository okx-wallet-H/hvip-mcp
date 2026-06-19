    if (_req.method === "GET" && (_req.url === "/api/memory" || _req.url?.startsWith("/api/memory?"))) {
      const u = new URL(_req.url, `http://${host}:${webPort}`)
      const type = u.searchParams.get("type") || ""
      const q = u.searchParams.get("q") || ""
      let entries
      if (type && (type === "memory" || type === "doc" || type === "directive" || type === "skill" || type === "strategy")) {
        entries = memory.byType(type as any, 50)
      } else if (q) {
        entries = memory.search(q, 30)
      } else {
        entries = memory.recent(30)
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(entries))
      return
    }
