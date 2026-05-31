'use client'

import { useEffect, useRef, useState } from 'react'
import { analyzeSession, chatQuestion, getOpenFda, NpraResult, OpenFdaResult, SIMPLE_LABELS, HIGH_PRIORITY_FIELDS } from '@/lib/api'

const SIMPLE_LABELS_OVERRIDE: Record<string, string> = {
  openfda_brand_name:            'Brand name',
  openfda_generic_name:          'Generic name',
  openfda_manufacturer_name:     'Made by',
  purpose:                       'What it does',
  indications_and_usage:         'What it treats',
  dosage_and_administration:     'How to take it',
  warnings:                      'Important warnings',
  warnings_and_cautions:         'Important warnings',
  precautions:                   'Before you take it',
  contraindications:             'Do not take if…',
  adverse_reactions:             'Possible side effects',
  drug_interactions:             'Medicines to avoid',
  keep_out_of_reach_of_children: 'Keep away from children',
  storage_and_handling:          'How to store it',
}

interface Step3Props {
  npraResult: NpraResult
  patientIndexed: boolean
  onBack: () => void
}

type Msg = { role: 'user' | 'ai'; text: string }

const CHIPS = [
  'What is this medicine for?',
  'Any risks for this patient?',
  'What are the side effects?',
  'How should I take this?',
]

function renderMd(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

export default function Step3({ npraResult, patientIndexed, onBack }: Step3Props) {
  const npra = npraResult.npra_info!
  const isApproved = !!npra.status?.toLowerCase().includes('approved')

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [fdaResult, setFdaResult] = useState<OpenFdaResult | null>(null)
  const [fdaLoading, setFdaLoading] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, chatLoading])

  // Auto-generate summary on mount
  useEffect(() => {
    let cancelled = false
    async function init() {
      setInitialLoading(true)
      try {
        const r = await analyzeSession()
        if (!cancelled) setMsgs([{ role: 'ai', text: r.summary }])
      } catch {
        if (!cancelled) setMsgs([{ role: 'ai', text: 'Here\'s what I found about this medicine. Feel free to ask me anything!' }])
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  const send = async (q: string) => {
    if (!q.trim() || chatLoading) return
    const text = q.trim()
    setInput('')
    setMsgs(prev => [...prev, { role: 'user', text }])
    setChatLoading(true)
    try {
      const r = await chatQuestion(text)
      setMsgs(prev => [...prev, { role: 'ai', text: r.answer }])
    } catch {
      setMsgs(prev => [...prev, { role: 'ai', text: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setChatLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const loadDetails = async () => {
    if (fdaResult || fdaLoading) return
    setFdaLoading(true)
    try {
      const r = await getOpenFda()
      setFdaResult(r)
    } catch { /* silent */ }
    finally { setFdaLoading(false) }
  }

  const toggleDetails = () => {
    const next = !detailsOpen
    setDetailsOpen(next)
    if (next && !fdaResult) loadDetails()
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* ── Top bar ───────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: '14px 24px',
        background: 'var(--surface)',
        borderBottom: '1px solid #F0EBE4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        {/* Back */}
        <button className="back-btn" onClick={onBack} style={{ marginBottom: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Check another medicine
        </button>

        {/* Medicine name + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center' }}>
          <p style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
            {npra.product}
          </p>
          <span className={`badge ${isApproved ? 'badge-success' : 'badge-warning'}`}>
            {isApproved ? '✓ Approved' : npra.status || 'Unknown'}
          </span>
        </div>

        {/* Details toggle */}
        <button
          onClick={toggleDetails}
          style={{
            background: detailsOpen ? 'var(--sage-light)' : 'transparent',
            border: '1.5px solid',
            borderColor: detailsOpen ? 'var(--sage-mid)' : '#E0D9CF',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: '0.82rem',
            fontWeight: 600,
            color: detailsOpen ? 'var(--sage)' : 'var(--ink-muted)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {detailsOpen ? 'Hide details' : 'View details'}
        </button>
      </div>

      {/* ── Main body ─────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Chat column */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', minWidth: 0,
        }}>
          {/* Thread */}
          <div className="chat-thread" style={{ padding: '24px 0' }}>
            <div style={{ maxWidth: 680, width: '100%', margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Initial loading */}
              {initialLoading && (
                <div className="bubble-ai fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                  <span style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>Analysing this medicine…</span>
                </div>
              )}

              {/* Messages */}
              {msgs.map((m, i) => (
                <div key={i} className="fade-up">
                  {m.role === 'ai' ? (
                    <div className="bubble-ai">
                      <div dangerouslySetInnerHTML={{ __html: renderMd(m.text) }} />
                      {i === 0 && (
                        <p className="disclaimer-note">
                          This is general information, not medical advice. Always speak to a doctor or pharmacist before taking any medicine.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div className="bubble-user">{m.text}</div>
                    </div>
                  )}
                </div>
              ))}

              {/* Chat loading */}
              {chatLoading && !initialLoading && (
                <div className="bubble-ai fade-up" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                  <span style={{ color: 'var(--ink-muted)', fontSize: '0.88rem' }}>Thinking…</span>
                </div>
              )}

              <div ref={endRef} />
            </div>
          </div>

          {/* Chips + Input */}
          <div style={{
            flexShrink: 0,
            background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
            padding: '12px 24px 20px',
          }}>
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
              {/* Suggestion chips — only before any user message */}
              {msgs.filter(m => m.role === 'user').length === 0 && !initialLoading && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {CHIPS.map(c => (
                    <button key={c} className="chip" onClick={() => send(c)} disabled={chatLoading}>
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {/* Input bar */}
              <div className="chat-input-bar">
                <textarea
                  ref={inputRef}
                  id="chat-input"
                  className="chat-input"
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
                  }}
                  placeholder="Ask anything about this medicine…"
                  disabled={initialLoading || chatLoading}
                />
                <button
                  id="send-btn"
                  onClick={() => send(input)}
                  disabled={initialLoading || chatLoading || !input.trim()}
                  style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: input.trim() && !initialLoading && !chatLoading ? 'var(--sage)' : '#E0D9CF',
                    border: 'none', cursor: input.trim() ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.2s',
                  }}
                >
                  {chatLoading
                    ? <div className="spinner" style={{ width: 16, height: 16, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                    : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                      </svg>
                    )
                  }
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Details sidebar — only when open */}
        {detailsOpen && (
          <div style={{
            width: 340, flexShrink: 0,
            background: 'var(--surface)',
            borderLeft: '1px solid #F0EBE4',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid #F0EBE4', flexShrink: 0 }}>
              <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ink)' }}>Medicine details</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', marginTop: 3 }}>From the Malaysian medicine database</p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Approval info */}
              <div style={{ marginBottom: 20 }}>
                <div className={`alert ${isApproved ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 16 }}>
                  <span>{isApproved ? '✓' : '⚠'}</span>
                  <span>
                    {isApproved
                      ? 'Registered and approved for sale in Malaysia.'
                      : "This medicine's status needs attention. Check with your pharmacist."}
                  </span>
                </div>

                <div className="field-table">
                  <Field label="Brand name" value={npra.product} />
                  <Field label="Active ingredient" value={npra.active_ingredient?.split('[')[0].trim()} />
                  <Field label="Generic name" value={npra.generic_name} />
                  <Field label="Made by" value={npra.manufacturer} />
                  <Field label="Registered by" value={npra.holder} />
                  <Field label="Type" value={npra.description} />
                  <Field label="Reg. number" value={npra.registration_no} />
                </div>
              </div>

              {/* Drug info */}
              <div>
                <p className="label-xs" style={{ marginBottom: 12 }}>Drug information</p>
                {!fdaResult && !fdaLoading && (
                  <button
                    className="btn btn-ghost btn-full"
                    style={{ fontSize: '0.84rem', padding: '10px 16px' }}
                    onClick={loadDetails}
                  >
                    Load full drug information
                  </button>
                )}
                {fdaLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-muted)', fontSize: '0.84rem', padding: '8px 0' }}>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                    Loading…
                  </div>
                )}
                {fdaResult?.drug_label_info && Object.keys(fdaResult.drug_label_info).length > 0 && (
                  <div className="card-sm accordion" style={{ overflow: 'hidden' }}>
                    {Object.entries(fdaResult.drug_label_info).map(([key, val]) => {
                      if (['openfda_brand_name','openfda_generic_name','openfda_manufacturer_name'].includes(key)) return null
                      const label = SIMPLE_LABELS_OVERRIDE[key] ?? key.replace(/_/g, ' ')
                      const isWarn = HIGH_PRIORITY_FIELDS.includes(key)
                      const short = val.length > 600 ? val.slice(0, 600) + '…' : val
                      return (
                        <details key={key}>
                          <summary>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              {isWarn && <span style={{ color: 'var(--amber)', fontSize: 12 }}>⚠</span>}
                              {label}
                            </span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ flexShrink: 0 }}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                          </summary>
                          <p>{short}</p>
                        </details>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
