'use client'

import { useCallback, useState } from 'react'
import { ocrImage, verifyNpra, NpraResult, OcrResult } from '@/lib/api'

interface UploadPanelProps {
  onNpraResult: (result: NpraResult) => void
  onPatientFile: (file: File) => void
  patientFileName?: string
  patientLoading: boolean
  patientIndexed: boolean
}

type Step = 'idle' | 'ocr-loading' | 'ocr-done' | 'verifying' | 'done' | 'error'

function UploadArea({
  id, label, sublabel, accept, onFile, fileName, icon,
}: {
  id: string; label: string; sublabel: string; accept: string
  onFile: (f: File) => void; fileName?: string; icon: string
}) {
  const [drag, setDrag] = useState(false)
  return (
    <label
      htmlFor={id}
      className={`upload-zone block ${drag ? 'dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false)
        const f = e.dataTransfer.files[0]; if (f) onFile(f)
      }}
    >
      <input id={id} type="file" accept={accept}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      <div className="flex flex-col items-center gap-2 pointer-events-none py-1">
        <span className="text-2xl">{icon}</span>
        {fileName ? (
          <>
            <p className="text-xs font-medium" style={{ color: 'var(--sage-deep)' }}>✓ {fileName}</p>
            <p className="text-[10px]" style={{ color: 'var(--sand)' }}>Tap to replace</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>{label}</p>
            <p className="text-[10px]" style={{ color: 'var(--sand)' }}>{sublabel}</p>
          </>
        )}
      </div>
    </label>
  )
}

export default function UploadPanel({
  onNpraResult, onPatientFile, patientFileName, patientLoading, patientIndexed
}: UploadPanelProps) {
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ocrRawText, setOcrRawText] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [verifyDone, setVerifyDone] = useState(false)

  const handleImage = (file: File) => {
    setImageFile(file); setPreviewUrl(URL.createObjectURL(file))
    setOcrRawText(''); setOcrText(''); setStep('idle'); setError(null); setVerifyDone(false)
  }

  const runScan = async () => {
    if (!imageFile) return
    setStep('ocr-loading'); setError(null)
    try {
      const r = await ocrImage(imageFile)
      setOcrRawText(r.raw_text)
      setOcrText(r.cleaned_text)
      setStep('ocr-done')
    } catch (e: any) { setError('Could not read the label. Try a clearer photo.'); setStep('error') }
  }

  const runVerify = async () => {
    if (!ocrText.trim()) return
    setStep('verifying'); setError(null)
    try {
      const r = await verifyNpra(ocrText, ocrRawText)
      onNpraResult(r)
      setVerifyDone(true); setStep('done')
    } catch (e: any) { setError('Verification failed. Please try again.'); setStep('ocr-done') }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0">
        <h2 className="font-serif text-base font-medium" style={{ color: 'var(--warm-dark)' }}>
          Get started
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--warm-gray)' }}>
          Upload your medicine and patient file
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5">

        {/* ── Step 1: Medicine photo ─────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="step-dot text-[11px]" style={imageFile ? { background: 'rgba(90,132,98,0.15)', color: 'var(--sage-deep)' } : {}}>
              {imageFile ? '✓' : '1'}
            </span>
            <p className="text-xs font-medium" style={{ color: 'var(--warm-dark)' }}>Medicine photo</p>
          </div>

          <UploadArea
            id="medicine-upload" label="Drop your medicine label here"
            sublabel="Photo of the box or packet works" accept="image/*"
            icon="💊" onFile={handleImage} fileName={imageFile?.name}
          />

          {previewUrl && (
            <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(196,185,170,0.3)', height: 120 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Label preview" className="w-full h-full object-contain" />
            </div>
          )}

          {imageFile && step === 'idle' && (
            <button id="run-ocr-btn" className="btn btn-sage w-full mt-3" onClick={runScan}>
              Read the label
            </button>
          )}

          {step === 'ocr-loading' && (
            <div className="flex items-center justify-center gap-2 mt-3 py-2">
              <div className="spinner" style={{ width: 16, height: 16 }} />
              <span className="text-xs" style={{ color: 'var(--warm-gray)' }}>Reading label…</span>
            </div>
          )}

          {(step === 'ocr-done' || step === 'verifying' || step === 'done') && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px]" style={{ color: 'var(--warm-gray)' }}>
                Detected text — fix any errors if needed
              </p>
              <textarea
                id="ocr-text-area"
                className="input-warm"
                rows={3} value={ocrText}
                onChange={e => setOcrText(e.target.value)}
                placeholder="Medicine name will appear here…"
              />
            </div>
          )}

          {(step === 'ocr-done') && (
            <button id="verify-btn" className="btn btn-sage w-full mt-2" onClick={runVerify}>
              Check this medicine
            </button>
          )}

          {step === 'verifying' && (
            <div className="flex items-center justify-center gap-2 mt-2 py-2">
              <div className="spinner" style={{ width: 16, height: 16 }} />
              <span className="text-xs" style={{ color: 'var(--warm-gray)' }}>Checking…</span>
            </div>
          )}

          {verifyDone && (
            <div className="inline-success mt-2">
              <span>✓</span> Medicine found — see details panel
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* ── Step 2: Patient file ───────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="step-dot text-[11px]" style={patientIndexed ? { background: 'rgba(90,132,98,0.15)', color: 'var(--sage-deep)' } : {}}>
              {patientIndexed ? '✓' : '2'}
            </span>
            <p className="text-xs font-medium" style={{ color: 'var(--warm-dark)' }}>Patient file <span style={{ color: 'var(--sand)', fontWeight: 400 }}>(optional)</span></p>
          </div>

          <UploadArea
            id="patient-upload" label="Drop patient history file here"
            sublabel="PDF with medical history, allergies, medications" accept="application/pdf"
            icon="📋" onFile={onPatientFile} fileName={patientFileName}
          />

          {patientLoading && (
            <div className="flex items-center gap-2 mt-2">
              <div className="spinner" style={{ width: 14, height: 14 }} />
              <span className="text-[11px]" style={{ color: 'var(--warm-gray)' }}>Reading file…</span>
            </div>
          )}
          {patientIndexed && !patientLoading && (
            <div className="inline-success mt-2">
              <span>✓</span> Patient info loaded
            </div>
          )}
        </div>

        {error && (
          <div className="inline-error">{error}</div>
        )}

        {/* Tip */}
        {!imageFile && (
          <div className="rounded-xl p-4 mt-2" style={{ background: 'rgba(135,168,142,0.07)', border: '1px solid rgba(135,168,142,0.15)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--sage-deep)' }}>
              💡 <strong>Tip:</strong> Upload a clear photo of your medicine packaging, then ask the assistant anything about it in the chat.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
