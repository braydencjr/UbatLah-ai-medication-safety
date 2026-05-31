'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner, EmptyState, ErrorBanner, GlowDivider } from './ui'
import { analyzeSession, chatQuestion, ChatResult } from '@/lib/api'

interface RightPanelProps {
  npraReady: boolean
  patientIndexed: boolean
}

type ChatMessage = {
  role: 'user' | 'ai'
  text: string
}

const DEMO_QUESTIONS = [
  'What is this medicine used for?',
  'Are there any concerns based on the patient case?',
  'Can this patient take it safely?',
]

// ── Minimal Markdown renderer ──────────────────────────────────────────
function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '$1')
}

export default function RightPanel({ npraReady, patientIndexed }: RightPanelProps) {
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const runAnalyze = async () => {
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    try {
      const result = await analyzeSession()
      setSummary(result.summary)
    } catch (e: any) {
      setAnalyzeError(e.message)
    } finally {
      setAnalyzeLoading(false)
    }
  }

  const sendChat = async (q: string) => {
    if (!q.trim() || chatLoading) return
    const userQ = q.trim()
    setQuestion('')
    setChatError(null)
    setMessages(prev => [...prev, { role: 'user', text: userQ }])
    setChatLoading(true)
    try {
      const result = await chatQuestion(userQ)
      setMessages(prev => [...prev, { role: 'ai', text: result.answer }])
    } catch (e: any) {
      setChatError(e.message)
      setMessages(prev => [...prev, { role: 'ai', text: `Error: ${e.message}` }])
    } finally {
      setChatLoading(false)
    }
  }

  const canAnalyze = npraReady
  const canChat = npraReady

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="text-[var(--violet)]">✦</span>
        <span>AI Safety Summary</span>
        <span className="ml-auto text-[8px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 uppercase tracking-wide">
          Gemini 2.5 Flash
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Analyze ───────────────────────────────── */}
        {!canAnalyze && (
          <EmptyState icon="✦" text="Complete NPRA verification to enable AI analysis" />
        )}

        {canAnalyze && !summary && (
          <div className="space-y-3">
            {!patientIndexed && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-[11px] text-amber-300">
                <span>ℹ</span>
                <span>No patient PDF indexed yet. Analysis will use drug label data only.</span>
              </div>
            )}
            <button
              id="run-analyze-btn"
              className="btn-primary w-full"
              onClick={runAnalyze}
              disabled={analyzeLoading}
            >
              {analyzeLoading
                ? <><Spinner size={14} /> Generating safety summary…</>
                : '✦ Generate AI Safety Summary'}
            </button>
          </div>
        )}

        {analyzeError && <ErrorBanner message={analyzeError} />}

        {summary && (
          <div className="glass-card p-4">
            <div className="prose-ubatlah">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)]">
              <button
                id="rerun-analyze-btn"
                className="btn-secondary text-[10px] py-1.5 px-3"
                onClick={runAnalyze}
                disabled={analyzeLoading}
              >
                {analyzeLoading ? <Spinner size={12} /> : '↻ Regenerate'}
              </button>
            </div>
          </div>
        )}

        {/* ── Chat ─────────────────────────────────── */}
        {canAnalyze && (
          <>
            <GlowDivider />

            <div className="panel-header" style={{ padding: '6px 0', borderBottom: 'none' }}>
              <span>💬</span>
              <span>Chatbot</span>
            </div>

            {/* Demo question chips */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {DEMO_QUESTIONS.map(q => (
                  <button
                    key={q}
                    className="text-[10px] px-3 py-1.5 rounded-full border border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors cursor-pointer bg-transparent"
                    onClick={() => sendChat(q)}
                    disabled={chatLoading}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Message thread */}
            {messages.length > 0 && (
              <div className="space-y-3">
                {messages.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="chat-bubble-user">{m.text}</div>
                  ) : (
                    <div key={i} className="chat-bubble-ai prose-ubatlah">
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                    </div>
                  )
                )}
                {chatLoading && (
                  <div className="chat-bubble-ai flex items-center gap-2">
                    <Spinner size={14} />
                    <span className="text-xs">Thinking…</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {chatError && <ErrorBanner message={chatError} />}

            {/* Chat input */}
            <div className="flex gap-2 items-end sticky bottom-0 pt-2"
              style={{ background: 'linear-gradient(to top, var(--bg-surface) 70%, transparent)' }}
            >
              <textarea
                id="chat-input"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendChat(question)
                  }
                }}
                placeholder={canChat ? 'Ask a question… (Enter to send)' : 'Complete NPRA verification first'}
                disabled={!canChat || chatLoading}
                rows={2}
                className="flex-1 rounded-xl text-xs p-3 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--teal)]"
                style={{
                  background: 'rgba(15,22,41,0.9)',
                  border: '1px solid var(--border-bright)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                id="send-chat-btn"
                className="btn-primary px-4 py-3 self-end"
                onClick={() => sendChat(question)}
                disabled={!canChat || chatLoading || !question.trim()}
              >
                {chatLoading ? <Spinner size={14} /> : '↑'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
