/**
 * SJTing 회의 서버 — Cloudflare Worker 진입점
 *  POST /api/rooms            방 생성 (방장 토큰·초대 토큰 발급)
 *  GET  /api/rooms/:id        방 존재·잠금 확인
 *  GET  /api/rooms/:id/ws     WebSocket 시그널링 (Durable Object 로 전달)
 *  ALL  /partytracks/*        Realtime SFU 프록시 (입장권 필요)
 *  GET  /api/health           상태·이번 달 사용량
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { routePartyTracksRequest } from 'partytracks/server'
import { CreateRoomSchema } from '../../src/shared/protocol'
import { DEFAULT_INVITE_TTL_SEC, MAX_PARTICIPANTS } from '../../src/shared/constants'
import type { CreateRoomResponse, ServerHealth } from '../../src/shared/types'
import { RateLimiter, randomId, randomToken, sha256Hex, verifyTicket } from './auth'
import { intVar, type Env } from './env'
import type { InitBody } from './RoomDO'
import type { UsageInfo } from './UsageMeterDO'

export { SjtingRoom } from './RoomDO'
export { UsageMeter } from './UsageMeterDO'

const app = new Hono<{ Bindings: Env }>()

// Electron 앱은 file:// 에서 실행되어 origin 이 null 이므로 모든 origin 을 허용한다.
// 실제 접근 제어는 토큰(방 생성은 공개, 나머지는 초대 토큰·입장권)으로 한다.
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'OPTIONS'] }))
app.use('/partytracks/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))

/** 방 생성 남용 방지 (인스턴스 로컬, 최선 노력) */
const createLimiter = new RateLimiter(10, 60_000)

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unknown'
}

async function usageInfo(env: Env): Promise<UsageInfo> {
  const stub = env.USAGE.get(env.USAGE.idFromName('global'))
  return (await (await stub.fetch('https://usage/')).json()) as UsageInfo
}

app.get('/api/health', async (c) => {
  const u = await usageInfo(c.env)
  const body: ServerHealth = {
    ok: true,
    version: c.env.APP_VERSION,
    maxParticipants: intVar(c.env.MAX_PARTICIPANTS, MAX_PARTICIPANTS),
    usage: { usedMinutes: u.usedMinutes, budgetMinutes: u.budgetMinutes, month: u.month }
  }
  return c.json(body)
})

app.post('/api/rooms', async (c) => {
  if (!createLimiter.hit(clientIp(c.req.raw))) return c.json({ error: 'RATE_LIMITED', message: '방 생성 요청이 너무 잦습니다' }, 429)
  const parsed = CreateRoomSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다' }, 400)

  const usage = await usageInfo(c.env)
  if (usage.exceeded) return c.json({ error: 'BUDGET_EXCEEDED', message: '이번 달 무료 사용량을 모두 사용했습니다. 다음 달에 다시 이용할 수 있습니다' }, 403)

  const roomId = randomId(10)
  const hostToken = randomToken(16)
  const inviteToken = randomToken(16)
  const ttl = parsed.data.inviteTtlSec ?? intVar(c.env.INVITE_TTL_SEC, DEFAULT_INVITE_TTL_SEC)
  const inviteExpiresAt = Math.floor(Date.now() / 1000) + ttl
  const init: InitBody = {
    hostTokenHash: await sha256Hex(hostToken),
    inviteTokenHash: await sha256Hex(inviteToken),
    inviteExpiresAt,
    inviteTtlSec: ttl,
    mode: parsed.data.mode,
    maxParticipants: Math.min(intVar(c.env.MAX_PARTICIPANTS, MAX_PARTICIPANTS), MAX_PARTICIPANTS)
  }
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(roomId))
  const res = await stub.fetch(`https://room/init?roomId=${roomId}`, { method: 'POST', body: JSON.stringify(init) })
  if (!res.ok) return c.json({ error: 'INTERNAL', message: '방을 만들 수 없습니다' }, 500)
  const body: CreateRoomResponse = { roomId, hostToken, inviteToken, inviteExpiresAt }
  return c.json(body)
})

app.get('/api/rooms/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[a-z0-9]{4,64}$/.test(id)) return c.json({ exists: false }, 404)
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(id))
  const res = await stub.fetch('https://room/info')
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
})

app.get('/api/rooms/:id/ws', async (c) => {
  const id = c.req.param('id')
  if (!/^[a-z0-9]{4,64}$/.test(id)) return c.text('not found', 404)
  if (c.req.header('Upgrade') !== 'websocket') return c.text('expected websocket', 426)
  const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(id))
  const headers = new Headers(c.req.raw.headers)
  headers.set('x-client-ip', clientIp(c.req.raw))
  return stub.fetch(new Request('https://room/ws', { method: 'GET', headers }))
})

// Realtime SFU 프록시 — 입장권(Bearer) 이 있어야 통과. 앱 비밀키는 서버에만 있다.
app.all('/partytracks/*', async (c) => {
  const auth = c.req.header('Authorization') ?? ''
  const ticket = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const payload = ticket ? await verifyTicket(c.env.TICKET_SECRET, ticket) : null
  if (!payload) return c.json({ error: 'UNAUTHORIZED', message: '입장권이 없거나 만료되었습니다' }, 401)
  return routePartyTracksRequest({
    appId: c.env.SFU_APP_ID,
    token: c.env.SFU_APP_TOKEN,
    request: c.req.raw,
    prefix: '/partytracks',
    // 앱은 file:// 에서 실행되어 쿠키를 보낼 수 없으므로 세션 잠금 대신 입장권으로 보호한다
    lockSessionToInitiator: false,
    turnServerAppId: c.env.TURN_APP_ID,
    turnServerAppToken: c.env.TURN_APP_TOKEN
  })
})

app.get('/api/usage', async (c) => {
  if (!c.env.ADMIN_KEY || c.req.header('Authorization') !== `Bearer ${c.env.ADMIN_KEY}`) return c.text('unauthorized', 401)
  return c.json(await usageInfo(c.env))
})

app.notFound((c) => c.text('SJTing server', 404))

export default app
