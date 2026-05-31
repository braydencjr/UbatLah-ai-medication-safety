'use client'

import { useEffect, useRef, useState } from 'react'
import {
    analyzeSession,
    chatQuestion,
    getOpenFda,
    ocrImage,
    uploadPatientCase,
    clearPatientCase,
    verifyNpra,
    type NpraResult,
    type OpenFdaResult,
} from '@/lib/api'

type Message = {
    role: 'user' | 'ai'
    text: string
}

const PROMPTS = [
    'What is this medicine for?',
    'How should I take it?',
    'What are the side effects?',
    'Any warning for this patient?',
]

function formatMarkdown(text: string): string {
    const lines = text
        .replace(/\r\n/g, '\n')
        .replace(/\s*•\s*/g, '\n• ')
        .trim()
        .split('\n')
    const output: string[] = []
    let paragraph: string[] = []
    let list: string[] = []

    const formatInline = (value: string) => value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

    const flushParagraph = () => {
        if (!paragraph.length) return
        output.push(`<p>${paragraph.map((line) => formatInline(line)).join('<br />')}</p>`)
        paragraph = []
    }

    const flushList = () => {
        if (!list.length) return
        output.push(`<ul>${list.join('')}</ul>`)
        list = []
    }

    for (const line of lines) {
        const trimmed = line.trim()

        if (!trimmed) {
            flushParagraph()
            flushList()
            continue
        }

        const heading = trimmed.match(/^#{1,3}\s+(.+)$/)
        if (heading) {
            flushParagraph()
            flushList()
            output.push(`<h3>${formatInline(heading[1])}</h3>`)
            continue
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/)
        if (bullet) {
            flushParagraph()
            list.push(`<li>${formatInline(bullet[1])}</li>`)
            continue
        }

        flushList()
        paragraph.push(trimmed)
    }

    flushParagraph()
    flushList()

    return output.join('')
}

function renderBody(text: string) {
    return { __html: formatMarkdown(text) }
}

function splitFactText(text: string): string[] {
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\s*•\s*/g, '\n• ')
        .replace(/[ \t]+/g, ' ')
        .trim()

    if (!normalized) return []

    const chunks = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const lines: string[] = []

    for (const chunk of chunks) {
        if (chunk.startsWith('• ')) {
            lines.push(chunk)
            continue
        }

        const sentences = chunk
            .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
            .map((line) => line.trim())
            .filter(Boolean)

        if (sentences.length > 1) {
            lines.push(...sentences)
        } else {
            lines.push(chunk)
        }
    }

    return lines
}

function ToneCard({
    title,
    value,
    note,
    tone,
}: {
    title: string
    value: string
    note?: string
    tone: 'success' | 'warning' | 'neutral' | 'danger'
}) {
    return (
        <div className={`tone-card tone-${tone}`}>
            <p className="tone-card-title">{title}</p>
            <p className="tone-card-value">{value}</p>
            {note && <p className="tone-card-note">{note}</p>}
        </div>
    )
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
    if (value === null || value === undefined || value === '') return null
    return (
        <div className="detail-row">
            <span>{label}</span>
            <strong>{String(value)}</strong>
        </div>
    )
}

function LabelBlock({ label, text }: { label: string; text?: string | null }) {
    if (!text) return null

    const displayLines = splitFactText(text)

    return (
        <article className="info-block">
            <p className="info-block-label">{label}</p>
            <ul className="info-block-list">
                {displayLines.map((line, index) => (
                    <li key={index} className="info-block-text">
                        {line}
                    </li>
                ))}
            </ul>
        </article>
    )
}

function StatusPill({ npra }: { npra: NpraResult | null }) {
    if (!npra) {
        return <span className="status-pill status-pending">Waiting for scan</span>
    }

    if (!npra.found) {
        return <span className="status-pill status-danger">Not verified</span>
    }

    const approved = npra.npra_info?.status?.toLowerCase().includes('approved')
    return (
        <span className={`status-pill ${approved ? 'status-success' : 'status-warning'}`}>
            {approved ? 'Certified' : 'Needs review'}
        </span>
    )
}

export default function MedicineDashboard() {
    const [labelFile, setLabelFile] = useState<File | null>(null)
    const [labelPreview, setLabelPreview] = useState<string | null>(null)
    const [scanState, setScanState] = useState<'idle' | 'ocr' | 'verify' | 'ready' | 'error'>('idle')
    const [scanError, setScanError] = useState<string | null>(null)
    const [npraResult, setNpraResult] = useState<NpraResult | null>(null)
    const [openFda, setOpenFda] = useState<OpenFdaResult | null>(null)
    const [openFdaLoading, setOpenFdaLoading] = useState(false)
    const [summary, setSummary] = useState<string | null>(null)
    const [summaryLoading, setSummaryLoading] = useState(false)

    const [patientFile, setPatientFile] = useState<File | null>(null)
    const [patientUploading, setPatientUploading] = useState(false)
    const [patientError, setPatientError] = useState<string | null>(null)
    const [patientIndexed, setPatientIndexed] = useState(false)

    const [messages, setMessages] = useState<Message[]>([])
    const [chatInput, setChatInput] = useState('')
    const [chatLoading, setChatLoading] = useState(false)

    const chatThreadRef = useRef<HTMLDivElement>(null)
    const labelInputRef = useRef<HTMLInputElement>(null)
    const patientInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (chatThreadRef.current) {
            chatThreadRef.current.scrollTo({
                top: chatThreadRef.current.scrollHeight,
                behavior: 'smooth'
            })
        }
    }, [messages, chatLoading])

    useEffect(() => {
        if (!labelFile) {
            setLabelPreview(null)
            return
        }

        const preview = URL.createObjectURL(labelFile)
        setLabelPreview(preview)

        return () => URL.revokeObjectURL(preview)
    }, [labelFile])

    const scanLabelFile = async (file: File) => {
        setScanError(null)
        setScanState('ocr')
        setNpraResult(null)
        setOpenFda(null)
        setSummary(null)

        try {
            const ocr = await ocrImage(file)
            setScanState('verify')

            const verified = await verifyNpra(ocr.cleaned_text, ocr.raw_text)
            setNpraResult(verified)

            if (verified.npra_info?.active_ingredient) {
                await fetchOpenFda(verified.npra_info.active_ingredient)
            } else {
                setOpenFda(null)
            }

            await refreshSummary()
            setScanState('ready')
        } catch {
            setScanError('Could not read the label. Try a clearer photo or a tighter crop.')
            setScanState('error')
        }
    }

    const resetLabel = () => {
        setLabelFile(null)
        setLabelPreview(null)
        setScanState('idle')
        setScanError(null)
        setNpraResult(null)
        setOpenFda(null)
        setSummary(null)
        setMessages([])
        setChatInput('')

        if (labelInputRef.current) {
            labelInputRef.current.value = ''
        }
    }

    const refreshSummary = async () => {
        setSummaryLoading(true)
        try {
            const result = await analyzeSession()
            setSummary(result.summary)
        } catch {
            setSummary('I could not generate a summary right now.')
        } finally {
            setSummaryLoading(false)
        }
    }

    const fetchOpenFda = async (ingredient?: string | null) => {
        setOpenFdaLoading(true)
        try {
            const result = await getOpenFda(ingredient ?? undefined)
            setOpenFda(result)
        } catch {
            setOpenFda(null)
        } finally {
            setOpenFdaLoading(false)
        }
    }

    const scanLabel = async () => {
        if (!labelFile) return
        await scanLabelFile(labelFile)
    }

    const handleLabelSelected = async (file: File) => {
        setLabelFile(file)
        await scanLabelFile(file)
    }

    const uploadPatient = async () => {
        if (!patientFile) return
        setPatientUploading(true)
        setPatientError(null)
        try {
            await uploadPatientCase(patientFile)
            setPatientIndexed(true)
            await refreshSummary()
        } catch (err: any) {
            setPatientError(err.message ?? 'Failed to upload patient case.')
        } finally {
            setPatientUploading(false)
        }
    }

    const clearPatient = async () => {
        setPatientUploading(true)
        setPatientError(null)
        try {
            await clearPatientCase()
            setPatientFile(null)
            setPatientIndexed(false)
            if (patientInputRef.current) {
                patientInputRef.current.value = ''
            }
        } catch (err: any) {
            setPatientError(err.message ?? 'Failed to clear patient case.')
        } finally {
            setPatientUploading(false)
        }
    }

    const sendChat = async (text: string) => {
        const question = text.trim()
        if (!question || chatLoading || !npraResult?.npra_info) return

        setChatInput('')
        setMessages((prev) => [...prev, { role: 'user', text: question }])
        setChatLoading(true)
        try {
            const result = await chatQuestion(question)
            setMessages((prev) => [...prev, { role: 'ai', text: result.answer }])
        } catch {
            setMessages((prev) => [...prev, { role: 'ai', text: 'Sorry, I could not answer that just now.' }])
        } finally {
            setChatLoading(false)
        }
    }

    const verified = !!npraResult?.found && !!npraResult.npra_info?.status?.toLowerCase().includes('approved')
    const medicineName = npraResult?.npra_info?.product ?? npraResult?.normalized_query ?? 'Medicine label'

    const openFdaFields = openFda?.drug_label_info ?? null
    const hasOpenFda = !!openFdaFields && Object.keys(openFdaFields).length > 0

    const isScanning = scanState === 'ocr' || scanState === 'verify'
    const isOcrActive = isScanning || scanState === 'ready'

    return (
        <main className="medicine-app">
            <section className="hero-shell">
                <div className="hero-copy">
                    <p className="eyebrow">UbatLah</p>
                    <h1>Scan a medicine label, verify it, then ask what it means.</h1>
                    <p className="hero-text">
                        The flow is simple: upload the label, let OCR and the LLM clean the text, check it against NPRA,
                        then review the medicine facts, warnings, and chat with the assistant.
                    </p>
                </div>

                <div className="workflow-strip">
                    <div className={`workflow-step ${labelFile ? 'is-done' : 'is-active'}`}>
                        <span>1</span>
                        <div>
                            <strong>Upload label</strong>
                            <p>Photo or crop of the medicine box.</p>
                        </div>
                    </div>
                    <div className={`workflow-step ${isOcrActive ? 'is-active' : ''}`}>
                        <span>2</span>
                        <div>
                            <strong>OCR + LLM cleanup</strong>
                            <p>Extract the medicine name before NPRA lookup.</p>
                        </div>
                    </div>
                    <div className={`workflow-step ${npraResult ? 'is-active' : ''}`}>
                        <span>3</span>
                        <div>
                            <strong>NPRA check</strong>
                            <p>Show certified or warning status only.</p>
                        </div>
                    </div>
                    <div className={`workflow-step ${summary ? 'is-active' : ''}`}>
                        <span>4</span>
                        <div>
                            <strong>Facts + chat</strong>
                            <p>Usage, effects, warnings, then follow-up questions.</p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="dashboard-grid">
                <div className="stack">
                    <article className="panel upload-panel">
                        <div className="panel-header">
                            <div>
                                <p className="section-kicker">Medicine label</p>
                                <h2>Start with the photo</h2>
                            </div>
                            <StatusPill npra={npraResult} />
                        </div>

                        {!labelFile && (
                            <label className="upload-zone subtle" htmlFor="medicine-upload">
                                <input
                                    ref={labelInputRef}
                                    id="medicine-upload"
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0]
                                        if (file) {
                                            void handleLabelSelected(file)
                                        }
                                        event.target.value = ''
                                    }}
                                />
                                <div className="upload-visual">
                                    <div className="upload-icon">✦</div>
                                    <p className="upload-title">Drop a medicine label here</p>
                                    <p className="upload-copy">JPG, PNG, or a phone photo. We will handle OCR, then normalize the medicine name.</p>
                                </div>
                            </label>
                        )}

                        {labelFile && (
                            <div className="file-preview-shell">
                                <div className="preview-frame">
                                    {labelPreview && <img src={labelPreview} alt="Medicine label preview" />}
                                </div>
                                <div className="preview-meta">
                                    <div>
                                        <p className="file-name">{labelFile.name}</p>
                                        <p className="file-size">{Math.max(1, Math.round(labelFile.size / 1024))} KB</p>
                                    </div>
                                    <div className="action-row">
                                        <button className="primary-btn" onClick={scanLabel} disabled={isScanning}>
                                            {isScanning ? 'Scanning...' : 'Scan label'}
                                        </button>
                                        <button className="ghost-btn" onClick={resetLabel}>Change</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {scanState === 'ocr' && (
                            <div className="status-row">
                                <span className="spinner" /> Reading the label...
                            </div>
                        )}

                        {scanState === 'verify' && (
                            <div className="status-row">
                                <span className="spinner" /> Passing the extracted name to the verifier...
                            </div>
                        )}

                        {scanError && <div className="notice notice-warning">{scanError}</div>}
                    </article>

                    {npraResult && (
                        <article className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="section-kicker">NPRA verification</p>
                                    <h2 className={!npraResult.found ? 'danger-text' : ''}>
                                        {verified ? 'Certified' : npraResult.found ? 'Found, but not certified' : 'Not verified'}
                                    </h2>
                                </div>
                                <button className="ghost-btn" onClick={() => refreshSummary()} disabled={summaryLoading}>
                                    {summaryLoading ? 'Updating...' : 'Refresh summary'}
                                </button>
                            </div>

                            <div className={`notice ${verified ? 'notice-success' : npraResult.found ? 'notice-warning' : 'notice-danger'}`}>
                                {verified
                                    ? 'This product is certified in Malaysia according to the NPRA record.'
                                    : npraResult.found
                                        ? 'This product was found in the NPRA database, but the status needs attention.'
                                        : npraResult.message ?? 'This medicine was not found in the NPRA database.'}
                            </div>

                            <div className="hero-metric-grid">
                                <ToneCard
                                    tone={verified ? 'success' : npraResult.found ? 'warning' : 'danger'}
                                    title="Detected product"
                                    value={medicineName}
                                    note={npraResult.normalized_query ? `LLM-normalized from the OCR text: ${npraResult.normalized_query}` : undefined}
                                />
                                <ToneCard
                                    tone={verified ? 'success' : npraResult.found ? 'neutral' : 'danger'}
                                    title="NPRA status"
                                    value={npraResult.npra_info?.status ?? 'Unregistered'}
                                    note={npraResult.npra_info?.registration_no 
                                        ? `Registration no. ${npraResult.npra_info.registration_no}` 
                                        : 'Warning: This product is not registered in the official NPRA database.'}
                                />
                                <ToneCard
                                    tone={verified ? 'success' : npraResult.found ? 'neutral' : 'danger'}
                                    title="Match score"
                                    value={npraResult.npra_info?.match_score ? `${npraResult.npra_info.match_score}` : 'n/a'}
                                    note={npraResult.npra_info?.match_reason ?? 'The scan did not match any approved medication. Exercise caution.'}
                                />
                            </div>

                            <div className="detail-grid">
                                <DetailRow label="Product" value={npraResult.npra_info?.product} />
                                <DetailRow label="Active ingredient" value={npraResult.npra_info?.active_ingredient?.split('[')[0].trim()} />
                                <DetailRow label="Generic name" value={npraResult.npra_info?.generic_name} />
                                <DetailRow label="Manufacturer" value={npraResult.npra_info?.manufacturer} />
                                <DetailRow label="Holder" value={npraResult.npra_info?.holder} />
                                    <DetailRow label="Why this score" value={npraResult.npra_info?.match_reason} />
                            </div>
                        </article>
                    )}

                    {hasOpenFda && (
                        <article className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="section-kicker">Medicine facts</p>
                                    <h2>Usage, effects, side effects, and warnings</h2>
                                </div>
                                <button className="ghost-btn" onClick={() => fetchOpenFda(npraResult?.npra_info?.active_ingredient)} disabled={openFdaLoading}>
                                    {openFdaLoading ? 'Loading...' : 'Reload facts'}
                                </button>
                            </div>

                            <div className="info-grid">
                                <LabelBlock label="Usage / effect" text={openFdaFields?.purpose ?? openFdaFields?.indications_and_usage} />
                                <LabelBlock label="How to use" text={openFdaFields?.dosage_and_administration} />
                                <LabelBlock label="Possible side effects" text={openFdaFields?.adverse_reactions} />
                                <LabelBlock label="Warnings" text={openFdaFields?.warnings ?? openFdaFields?.warnings_and_cautions ?? openFdaFields?.precautions} />
                                <LabelBlock label="Do not use if" text={openFdaFields?.contraindications} />
                                <LabelBlock label="Drug interactions" text={openFdaFields?.drug_interactions} />
                                <LabelBlock label="Storage" text={openFdaFields?.storage_and_handling} />
                            </div>
                        </article>
                    )}

                    <article className="panel summary-panel">
                        <div className="panel-header">
                            <div>
                                <p className="section-kicker">Patient context</p>
                                <h2>Case-aware summary</h2>
                            </div>
                            <button className="ghost-btn" onClick={refreshSummary} disabled={summaryLoading || !npraResult}>
                                {summaryLoading ? 'Building...' : 'Generate'}
                            </button>
                        </div>

                        <div className="summary-shell">
                            {summary ? (
                                <div className="prose-block" dangerouslySetInnerHTML={renderBody(summary)} />
                            ) : (
                                <div className="empty-copy">
                                    <p>Upload a patient PDF if you want the assistant to factor allergies, conditions, and medicines into the summary.</p>
                                </div>
                            )}
                        </div>

                        <div className="patient-card-inline">
                            <div>
                                <p className="inline-title">Patient file</p>
                                <p className="inline-copy">Optional. It improves the warning section if a case file is uploaded.</p>
                            </div>
                            <div className="action-row">
                                <label className="ghost-btn file-trigger" htmlFor="patient-upload">
                                    Choose PDF
                                    <input
                                        ref={patientInputRef}
                                        id="patient-upload"
                                        type="file"
                                        accept="application/pdf"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0]
                                            if (file) setPatientFile(file)
                                            event.target.value = ''
                                        }}
                                    />
                                </label>
                                <button className="primary-btn" onClick={uploadPatient} disabled={!patientFile || patientUploading}>
                                    {patientUploading ? 'Reading...' : patientIndexed ? 'Refresh file' : 'Load case'}
                                </button>
                                {patientIndexed && (
                                    <button className="ghost-btn danger-text" onClick={clearPatient} disabled={patientUploading}>
                                        Clear case
                                    </button>
                                )}
                            </div>
                        </div>

                        {patientFile && (
                            <div className="file-chip-row">
                                <span className="file-chip">{patientFile.name}</span>
                                <span className="file-chip subtle">{Math.max(1, Math.round(patientFile.size / 1024))} KB</span>
                            </div>
                        )}

                        {patientIndexed && <div className="notice notice-success">Patient information is loaded for this session.</div>}
                        {patientError && <div className="notice notice-warning">{patientError}</div>}
                    </article>
                </div>

                <aside className="panel chat-panel">
                    <div className="panel-header">
                        <div>
                            <p className="section-kicker">Chat</p>
                            <h2>Ask follow-up questions</h2>
                        </div>
                        <span className="chat-state">{npraResult?.found ? 'Ready' : 'Locked until verification'}</span>
                    </div>

                    <div className="chat-thread" ref={chatThreadRef}>
                        {messages.length === 0 && (
                            <div className="empty-copy chat-empty">
                                <p>Try a quick question after the medicine is verified.</p>
                            </div>
                        )}

                        {messages.map((message, index) => (
                            <div key={index} className={message.role === 'ai' ? 'bubble bubble-ai' : 'bubble bubble-user'}>
                                {message.role === 'ai' ? (
                                    <div dangerouslySetInnerHTML={renderBody(message.text)} />
                                ) : (
                                    <p>{message.text}</p>
                                )}
                            </div>
                        ))}

                        {chatLoading && (
                            <div className="bubble bubble-ai bubble-loading">
                                <span className="spinner" /> Thinking...
                            </div>
                        )}
                    </div>

                    <div className="prompt-row">
                        {PROMPTS.map((prompt) => (
                            <button key={prompt} className="chip" onClick={() => sendChat(prompt)} disabled={!npraResult?.found || chatLoading}>
                                {prompt}
                            </button>
                        ))}
                    </div>

                    <div className="chat-bar">
                        <textarea
                            className="chat-input"
                            value={chatInput}
                            onChange={(event) => setChatInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    sendChat(chatInput)
                                }
                            }}
                            placeholder={npraResult?.found ? 'Ask about dosage, warnings, or interactions...' : 'Verify a medicine first'}
                            disabled={!npraResult?.found || chatLoading}
                            rows={4}
                        />
                        <button className="primary-btn send-btn" onClick={() => sendChat(chatInput)} disabled={!npraResult?.found || chatLoading || !chatInput.trim()}>
                            {chatLoading ? '...' : 'Send'}
                        </button>
                    </div>
                </aside>
            </section>
        </main>
    )
}