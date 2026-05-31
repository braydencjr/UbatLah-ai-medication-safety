'use client'

import { useCallback, useState } from 'react'
import { ocrImage, verifyNpra, NpraResult, OcrResult } from '@/lib/api'

interface Step1Props {
  onDone: (npra: NpraResult, ocr: OcrResult) => void
}

export default function Step1({ onDone }: Step1Props) {
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'ocr' | 'done-ocr' | 'verify' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const pickFile = useCallback((f: File) => {
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setOcr(null); setOcrText(''); setPhase('idle'); setError(null)
  }, [])

  const readLabel = async () => {
    if (!file) return
    setPhase('ocr'); setError(null)
    try {
      const r = await ocrImage(file)
      setOcr(r); setOcrText(r.cleaned_text); setPhase('done-ocr')
    } catch { setError('Could not read the label. Try a clearer photo.'); setPhase('idle') }
  }

  const checkMedicine = async () => {
    if (!ocr) return
    setPhase('verify'); setError(null)
    try {
      const r = await verifyNpra(ocrText, ocr?.raw_text)
      if (r.found) { onDone(r, { ...ocr, cleaned_text: ocrText }) }
      else { setError('This medicine was not found in the database. Check the photo or type the name manually.'); setPhase('done-ocr') }
    } catch { setError('Verification failed. Please try again.'); setPhase('done-ocr') }
  }

  return (
    <div className="page-center">
      <div className="content-well fade-up">

        {/* Brand */}
        <div className="brand-mark">
          <div className="brand-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="UbatLah" style={{ width: 26, height: 26, objectFit: 'contain' }} />
          </div>
          <span className="serif" style={{ fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)' }}>UbatLah</span>
        </div>

        {/* Headline */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <h1 className="serif" style={{ fontSize: '2rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, marginBottom: 10 }}>
            Check your medicine
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.95rem', maxWidth: 360, margin: '0 auto' }}>
            Take a photo of your medicine box or packet. We'll check it's safe and answer your questions.
          </p>
        </div>

        {/* Upload zone */}
        {!file && (
          <label
            htmlFor="med-upload"
            className={`upload-zone block ${drag ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
          >
            <input id="med-upload" type="file" accept="image/*"
              onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }} />
            <div className="pointer-events-none flex flex-col items-center gap-4">
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: 'var(--sage-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="var(--sage)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '0.95rem', marginBottom: 4 }}>
                  Tap to take a photo or choose a file
                </p>
                <p style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                  Works with JPG, PNG, or any image file
                </p>
              </div>
            </div>
          </label>
        )}

        {/* Preview + flow */}
        {file && (
          <div className="card" style={{ overflow: 'hidden' }}>
            {/* Image preview */}
            <div style={{ background: '#F5F0E8', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview!} alt="Medicine label" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
              <button
                onClick={() => { setFile(null); setPreview(null); setPhase('idle'); setOcr(null) }}
                style={{
                  position: 'absolute', top: 10, right: 10,
                  background: 'rgba(28,25,23,0.55)', color: '#fff',
                  border: 'none', borderRadius: 99, width: 28, height: 28,
                  fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title="Remove photo"
              >✕</button>
            </div>

            <div style={{ padding: 24 }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginBottom: 16 }}>
                <strong style={{ color: 'var(--ink)' }}>{file.name}</strong>
              </p>

              {/* Phase: idle → read label */}
              {phase === 'idle' && (
                <button id="read-label-btn" className="btn btn-primary btn-lg btn-full" onClick={readLabel}>
                  Read the label
                </button>
              )}

              {/* Phase: OCR loading */}
              {phase === 'ocr' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
                  <div className="spinner" style={{ width: 18, height: 18 }} />
                  Reading label…
                </div>
              )}

              {/* Phase: OCR done */}
              {(phase === 'done-ocr' || phase === 'verify') && (
                <div>
                  <p className="label-xs" style={{ marginBottom: 8 }}>What we detected — edit if needed</p>
                  <textarea
                    className="ocr-textarea"
                    value={ocrText}
                    onChange={e => setOcrText(e.target.value)}
                    rows={3}
                    placeholder="Medicine name appears here…"
                  />
                  <div style={{ marginTop: 12 }}>
                    {phase === 'done-ocr' ? (
                      <button id="check-medicine-btn" className="btn btn-primary btn-lg btn-full" onClick={checkMedicine}>
                        Check this medicine
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-muted)', fontSize: '0.88rem' }}>
                        <div className="spinner" style={{ width: 18, height: 18 }} />
                        Checking…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="alert alert-warning" style={{ marginTop: 12 }}>
                  <span>⚠</span><span>{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Change photo link when file selected */}
        {file && (
          <p style={{ textAlign: 'center', marginTop: 14, fontSize: '0.82rem', color: 'var(--ink-muted)' }}>
            <label htmlFor="med-upload-2" style={{ cursor: 'pointer', color: 'var(--sage)', fontWeight: 500 }}>
              Use a different photo
              <input id="med-upload-2" type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }} />
            </label>
          </p>
        )}
      </div>
    </div>
  )
}
