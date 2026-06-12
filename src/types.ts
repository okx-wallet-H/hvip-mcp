export interface ApiResponse<T = unknown> {
  ok: boolean
  source: string
  data: T | null
  meta: Record<string, unknown>
}

export function ok<T>(data: T, source: string, meta: Record<string, unknown> = {}): ApiResponse<T> {
  return { ok: true, source, data, meta }
}

export function err(message: string, source: string, code = ""): ApiResponse<null> {
  return { ok: false, source, data: null, meta: { error: message, code } }
}
