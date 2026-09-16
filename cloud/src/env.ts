export interface Env {
  ROOMS: DurableObjectNamespace
  USAGE: DurableObjectNamespace
  /** 웹앱 정적 파일 (Workers Static Assets) */
  ASSETS: Fetcher
  MIN_APP_VERSION: string
  APP_VERSION: string
  MAX_PARTICIPANTS: string
  MONTHLY_BUDGET_MINUTES: string
  INVITE_TTL_SEC: string
  // secrets
  SFU_APP_ID: string
  SFU_APP_TOKEN: string
  TICKET_SECRET: string
  TURN_APP_ID?: string
  TURN_APP_TOKEN?: string
  ADMIN_KEY?: string
}

export function intVar(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
