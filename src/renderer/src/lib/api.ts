/** 회의 서버 HTTP API 호출 */
import type { CreateRoomRequest } from '@shared/protocol'
import type { CreateRoomResponse, ServerHealth } from '@shared/types'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function call<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${serverUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    throw new ApiError('NETWORK', `회의 서버에 연결할 수 없습니다 (${serverUrl}). 인터넷 연결과 서버 주소를 확인하세요`, 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(body.error ?? 'HTTP_' + res.status, body.message ?? `서버 오류 (${res.status})`, res.status)
  return body as T
}

export function getHealth(serverUrl: string): Promise<ServerHealth> {
  return call<ServerHealth>(serverUrl, '/api/health')
}

export function createRoom(serverUrl: string, req: CreateRoomRequest): Promise<CreateRoomResponse> {
  return call<CreateRoomResponse>(serverUrl, '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  })
}

export interface RoomInfo {
  exists: boolean
  closed?: boolean
  locked?: boolean
  participantCount?: number
  maxParticipants?: number
}

export function getRoomInfo(serverUrl: string, roomId: string): Promise<RoomInfo> {
  return call<RoomInfo>(serverUrl, `/api/rooms/${encodeURIComponent(roomId)}`).catch((e: ApiError) => {
    if (e.status === 404) return { exists: false }
    throw e
  })
}

export function wsUrl(serverUrl: string, roomId: string): string {
  return `${serverUrl.replace(/^http/, 'ws')}/api/rooms/${encodeURIComponent(roomId)}/ws`
}
