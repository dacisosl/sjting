/**
 * 월별 사용량 계량기 — 참가자-분을 누적해 무료 전송량 예산을 넘지 않게 막는다 ("차단 장치").
 * 전역 단일 인스턴스 (idFromName('global')).
 */
import { DurableObject } from 'cloudflare:workers'
import { intVar, type Env } from './env'
import { DEFAULT_MONTHLY_BUDGET_MINUTES } from '../../src/shared/constants'

export interface UsageInfo {
  month: string
  usedMinutes: number
  budgetMinutes: number
  exceeded: boolean
}

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export class UsageMeter extends DurableObject<Env> {
  private budget(): number {
    return intVar(this.env.MONTHLY_BUDGET_MINUTES, DEFAULT_MONTHLY_BUDGET_MINUTES)
  }

  async info(): Promise<UsageInfo> {
    const month = monthKey()
    const used = (await this.ctx.storage.get<number>(`usage:${month}`)) ?? 0
    const budget = this.budget()
    return { month, usedMinutes: used, budgetMinutes: budget, exceeded: used >= budget }
  }

  async add(minutes: number): Promise<UsageInfo> {
    const month = monthKey()
    const key = `usage:${month}`
    const used = ((await this.ctx.storage.get<number>(key)) ?? 0) + Math.max(0, Math.floor(minutes))
    await this.ctx.storage.put(key, used)
    const budget = this.budget()
    return { month, usedMinutes: used, budgetMinutes: budget, exceeded: used >= budget }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/add') {
      const body = (await request.json().catch(() => ({}))) as { minutes?: number }
      return Response.json(await this.add(Number(body.minutes ?? 0)))
    }
    return Response.json(await this.info())
  }
}
