'use client'

import { useCallback, useState } from 'react'
import { uploadPatientCase } from '@/lib/api'

interface Step2Props {
  medicineName: string
  onDone: (patientIndexed: boolean) => void
  onSkip: () => void
}

export default function Step2({ medicineName, onDone, onSkip }: Step2Props) {
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback((f: File) => {
    setFile(f); setError(null)
  }, [])

  const handleUpload = async () => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      await uploadPatientCase(file)
      onDone(true)
    } catch {
      setError('Could not read the file. Make sure it\'s a PDF and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="page-center">
      <div className="content-well fade-up">

        {/* Step indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
          <div className="step-bar">
            <div className="step-pip done" />
            <div className="step-pip active" />
            <div className="step-pip" />
          </div>
        </div>

        {/* Headline */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 99,
            background: 'var(--sage-light)', marginBottom: 20,
          }}>
            <span style={{ fontSize: 12 }}>✓</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--sage)', letterSpacing: '0.02em' }}>
              {medicineName || 'Medicine verified'}
            </span>
          </div>

          <h1 className="serif" style={{ fontSize: '1.85rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.25, marginBottom: 10 }}>
            Add a patient file
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '0.92rem', maxWidth: 380, margin: '0 auto' }}>
            This helps us spot any risks based on allergies, current medications, or health conditions.
          </p>
        </div>

        {/* Upload zone */}
        {!file ? (
          <label
            htmlFor="patient-upload"
            className={`upload-zone block ${drag ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <input id="patient-upload" type="file" accept="application/pdf"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            <div className="pointer-events-none flex flex-col items-center gap-4">
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: 'var(--sage-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="var(--sage)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '0.95rem', marginBottom: 4 }}>
                  Upload a patient history PDF
                </p>
                <p style={{ color: 'var(--ink-muted)', fontSize: '0.82rem' }}>
                  A summary of allergies, conditions, and medications
                </p>
              </div>
            </div>
          </label>
        ) : (
          /* File selected */
          <div className="card-sm" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: 'var(--sage-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="var(--sage)" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </p>
              <p style={{ color: 'var(--ink-muted)', fontSize: '0.78rem', marginTop: 2 }}>
                {(file.size / 1024).toFixed(0)} KB · PDF
              </p>
            </div>
            <button
              onClick={() => setFile(null)}
              style={{ color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
            >✕</button>
          </div>
        )}

        {error && (
          <div className="alert alert-warning" style={{ marginTop: 12 }}>
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {file ? (
            <button
              id="upload-patient-btn"
              className="btn btn-primary btn-lg btn-full"
              onClick={handleUpload}
              disabled={loading}
            >
              {loading
                ? <><div className="spinner" style={{ width: 18, height: 18 }} /> Reading file…</>
                : 'Continue with this file'}
            </button>
          ) : null}

          <button
            id="skip-patient-btn"
            className="btn btn-ghost btn-lg btn-full"
            onClick={onSkip}
            style={{ marginTop: file ? 0 : 12 }}
          >
            {file ? 'Skip — use drug info only' : 'Skip this step'}
          </button>
        </div>

        <p style={{ textAlign: 'center', marginTop: 18, fontSize: '0.78rem', color: 'var(--ink-faint)' }}>
          Your file stays on your device and is only used for this session.
        </p>
      </div>
    </div>
  )
}
