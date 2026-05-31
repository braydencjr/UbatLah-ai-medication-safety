'use client'

import { useEffect, useRef, useState } from 'react'
import { analyzeSession, chatQuestion } from '@/lib/api'

interface ChatPanelProps {
  medicineReady: boolean
  patientIndexed: boolean
}

type Msg = { role: 'user' | 'ai'; text: string }

const SUGGESTIONS = [
  'What is this medicine for?',
  'Any concerns for this patient?',
  'Is it safe to take with warfarin?',
  'What are the side effects?',
]

function renderMd(text: string) {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
}

export default function ChatPanel({ medicineReady, patientIndexed }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryShown, setSummaryShown] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading])

  const send = async (q: string) => {
    if (!q.trim() || loading) return
    const text = q.trim()
    setInput('')
    setMsgs(prev => [...prev, { role: 'user', text }])
    setLoading(true)
    try {
      const r = await chatQuestion(text)
      setMsgs(prev => [...prev, { role: 'ai', text: r.answer }])
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'ai', text: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const getSummary = async () => {
    setSummaryLoading(true)
    try {
      const r = await analyzeSession()
      setMsgs(prev => [...prev, { role: 'ai', text: r.summary }])
      setSummaryShown(true)
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'ai', text: 'Could not generate a summary. Please try again.' }])
    } finally {
      setSummaryLoading(false)
    }
  }

  const isEmpty = msgs.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div
        className="flex-shrink-0 px-7 pt-6 pb-4"
        style={{ borderBottom: '1px solid rgba(196,185,170,0.18)' }}
      >
        <h2 className="font-serif text-xl font-medium" style={{ color: 'var(--warm-dark)' }}>
          Ask about your medicine
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--warm-gray)' }}>
          {medicineReady
            ? 'Your medicine is loaded. Ask anything below.'
            : 'Upload a medicine photo on the left to get started.'}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4">

        {/* Empty welcome state */}
        {isEmpty && (
          <div className="animate-in">
            {medicineReady ? (
              <div className="space-y-5">
                {/* Quick summary button */}
                {!summaryShown && (
                  <div
                    className="rounded-2xl p-5 cursor-pointer transition-all duration-200"
                    style={{
                      background: 'rgba(255,252,248,0.9)',
                      border: '1px solid rgba(196,185,170,0.28)',
                      boxShadow: '0 2px 16px rgba(61,58,54,0.07)',
                    }}
                  >
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--sage-deep)' }}>✨ Quick summary</p>
                    <p className="text-sm font-serif" style={{ color: 'var(--warm-dark)' }}>
                      Get a full safety overview for this patient
                    </p>
                    <button
                      id="get-summary-btn"
                      className="btn btn-sage mt-4"
                      onClick={getSummary}
                      disabled={summaryLoading}
                    >
                      {summaryLoading
                        ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating…</>
                        : 'Get safety summary'}
                    </button>
                    {!patientIndexed && (
                      <p className="text-[10px] mt-2" style={{ color: 'var(--sand)' }}>
                        No patient file uploaded — summary will cover general drug info only
                      </p>
                    )}
                  </div>
                )}

                {/* Suggestion chips */}
                <div>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--sand)' }}>Try asking:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        className="chip"
                        onClick={() => send(s)}
                        disabled={loading}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state mt-10">
                <div className="empty-state-icon">💬</div>
                <p className="font-serif text-base" style={{ color: 'var(--warm-dark)' }}>
                  Start by uploading your medicine
                </p>
                <p className="text-xs max-w-xs" style={{ color: 'var(--warm-gray)' }}>
                  Take a photo of the medicine box or packet, then come back here to ask questions.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Message thread */}
        {msgs.map((m, i) => (
          <div key={i} className="animate-in">
            {m.role === 'user' ? (
              <div className="bubble-user">{m.text}</div>
            ) : (
              <div className="bubble-ai ai-prose">
                <div dangerouslySetInnerHTML={{ __html: renderMd(m.text) }} />
                <p className="note">This is general information, not medical advice. Always consult your doctor or pharmacist.</p>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {(loading || summaryLoading) && (
          <div className="bubble-ai flex items-center gap-2 animate-in">
            <div className="spinner" style={{ width: 14, height: 14 }} />
            <span className="text-xs" style={{ color: 'var(--warm-gray)' }}>Thinking…</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Suggestion re-prompt if there are messages */}
      {msgs.length > 0 && !loading && (
        <div className="flex-shrink-0 px-7 pb-2">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.filter((_, i) => i < 2).map(s => (
              <button key={s} className="chip" onClick={() => send(s)} disabled={loading}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className="flex-shrink-0 px-7 pb-5 pt-3"
        style={{ borderTop: '1px solid rgba(196,185,170,0.18)' }}
      >
        <div className="flex gap-3 items-end">
          <textarea
            id="chat-input"
            className="input-warm flex-1"
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
            }}
            placeholder={
              medicineReady
                ? 'Type your question here…'
                : 'Upload a medicine photo first to ask questions'
            }
            disabled={!medicineReady || loading}
          />
          <button
            id="send-btn"
            className="btn btn-sage flex-shrink-0"
            style={{ padding: '10px 18px', alignSelf: 'flex-end' }}
            onClick={() => send(input)}
            disabled={!medicineReady || loading || !input.trim()}
          >
            {loading
              ? <div className="spinner" style={{ width: 14, height: 14 }} />
              : <span>Send</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
