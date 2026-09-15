import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { clsx } from 'clsx'
import { CHAT_MAX_LENGTH } from '@shared/constants'
import { meetingClient } from '../lib/MeetingClient'
import { useMeetingStore } from '../store/meetingStore'
import { Button, Input } from './ui'

export default function ChatPanel() {
  const chat = useMeetingStore((s) => s.chat)
  const me = useMeetingStore((s) => s.me)
  const toast = useMeetingStore((s) => s.toast)
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [chat.length])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    try {
      await meetingClient.sendChat(t)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin flex-1 space-y-2 overflow-auto p-3">
        {chat.length === 0 && <p className="text-center text-xs text-slate-500">채팅은 방장 PC 메모리에만 유지되며 회의 종료 시 삭제됩니다.</p>}
        {chat.map((m) => (
          <div key={m.id} className={clsx('text-sm', m.system && 'text-center text-xs text-slate-500')}>
            {m.system ? (
              <span>{m.text}</span>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={clsx('text-xs font-medium', m.participantId === me?.participantId ? 'text-sky-300' : 'text-slate-300')}>{m.displayName}</span>
                  <span className="text-[10px] text-slate-500">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-slate-100">{m.text}</p>
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-slate-800 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Input value={text} maxLength={CHAT_MAX_LENGTH} placeholder="메시지 입력" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  )
}
