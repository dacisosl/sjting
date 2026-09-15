/** WebSocket 시그널링 클라이언트 — 요청/응답 매칭과 이벤트 전달만 담당 */
import type { EventMap, EventName, RequestData, RequestMethod, ResponseMap, ServerMessage } from '@shared/protocol'
import { isServerEvent } from '@shared/protocol'

export class SignalingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SignalingError'
  }
}

type EventHandler<E extends EventName> = (data: EventMap[E]) => void

const REQUEST_TIMEOUT_MS = 15_000

export class SignalingClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>()
  private handlers = new Map<EventName, Set<EventHandler<EventName>>>()
  private closeHandlers = new Set<(code: number, reason: string) => void>()
  private intentionalClose = false

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string, timeoutMs = 10_000): Promise<void> {
    this.intentionalClose = false
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const timer = window.setTimeout(() => {
        ws.close()
        reject(new SignalingError('TIMEOUT', '방장 PC 에 연결할 수 없습니다 (시간 초과). 초대코드와 네트워크를 확인하세요'))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new SignalingError('CONNECT_FAILED', '방장 PC 에 연결할 수 없습니다. 인증서 검증 실패 또는 포트 차단일 수 있습니다'))
      }
      ws.onmessage = (ev) => this.onMessage(ev)
      ws.onclose = (ev) => {
        clearTimeout(timer)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new SignalingError('CLOSED', '연결이 끊어졌습니다'))
        }
        this.pending.clear()
        if (this.ws === ws) this.ws = null
        if (!this.intentionalClose) for (const h of this.closeHandlers) h(ev.code, ev.reason)
      }
    })
  }

  private onMessage(ev: MessageEvent): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (isServerEvent(msg)) {
      const hs = this.handlers.get(msg.event)
      if (hs) for (const h of hs) h(msg.data as EventMap[EventName])
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.data)
    else p.reject(new SignalingError(msg.error.code, msg.error.message))
  }

  request<M extends RequestMethod>(method: M, data: RequestData<M>): Promise<ResponseMap[M]> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new SignalingError('CLOSED', '연결되어 있지 않습니다'))
      }
      const id = this.nextId++
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new SignalingError('TIMEOUT', `요청 시간 초과 (${method})`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.ws.send(JSON.stringify({ id, method, data }))
    })
  }

  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as EventHandler<EventName>)
    return () => set!.delete(handler as EventHandler<EventName>)
  }

  onClose(handler: (code: number, reason: string) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  close(): void {
    this.intentionalClose = true
    this.ws?.close(1000, 'bye')
    this.ws = null
  }

  removeAllHandlers(): void {
    this.handlers.clear()
    this.closeHandlers.clear()
  }
}
