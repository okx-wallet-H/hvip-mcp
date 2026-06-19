import { useState, useEffect, useCallback } from "react"

const API_BASE = "/api"

export interface Agent {
  agentId: string
  name: string
  status: "idle" | "working" | "offline"
  capabilities: string[]
  lastSeen: string
  version?: string
}

export interface Task {
  taskId: string
  title: string
  status: "unassigned" | "assigned" | "done" | "reviewed"
  assignedTo?: string
  result?: string
  branch?: string
  template?: string
  claimedAt?: string
  reviewedAt?: string
}

export interface StatusResponse {
  version: string
  agents: Agent[]
  tasks: Task[]
  uptime: number
  registry: string
}

export function useApi() {
  const [data, setData] = useState<StatusResponse>({ version: "0.4.3", agents: [], tasks: [], uptime: 0, registry: "" })
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/status`)
      if (r.ok) {
        const s: StatusResponse = await r.json()
        setData(s)
        setLastRefresh(new Date())
      }
    } catch {
      // API not ready yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const spawnWorker = async (taskId: string) => {
    const r = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/spawn`, { method: "POST" })
    if (r.ok) {
      setTimeout(refresh, 800)
      return true
    }
    return false
  }

  const createTask = async (payload: { taskId: string; title: string; template: string; params: Record<string, string> }) => {
    const r = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return r.ok
  }

  return { ...data, loading, lastRefresh, refresh, spawnWorker, createTask }
}
