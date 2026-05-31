'use client'

import { useState } from 'react'
import UploadZone from './UploadZone'
import { Spinner, ErrorBanner, SectionTitle, GlowDivider } from './ui'
import { ocrImage, verifyNpra, NpraResult, OcrResult } from '@/lib/api'

interface LeftPanelProps {
  onNpraResult: (result: NpraResult) => void
  onPatientFile: (file: File) => void
  patientFileName?: string
  patientLoading: boolean
  patientIndexed: boolean
}

type Step = 'idle' | 'ocr-loading' | 'ocr-done' | 'npra-loading' | 'npra-done' | 'error'

const ImageIcon = () => (
  <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/>
  </svg>
)

const PdfIcon = () => (
  <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
  </svg>
)

export default function LeftPanel({
  onNpraResult, onPatientFile, patientFileName, patientLoading, patientIndexed
}: LeftPanelProps) {
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [editedOcrText, setEditedOcrText] = useState('')
  const [npraLoading, setNpraLoading] = useState(false)

  const handleImageFile = (file: File) => {
    setImageFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setOcrResult(null)
    setEditedOcrText('')
    setStep('idle')
    setError(null)
  }

  const runOcr = async () => {
    if (!imageFile) return
    setStep('ocr-loading')
    setError(null)
    try {
      const result = await ocrImage(imageFile)
      setOcrResult(result)
      setEditedOcrText(result.cleaned_text)
      setStep('ocr-done')
    } catch (e: any) {
      setError(e.message)
      setStep('error')
    }
  }

  const runNpraVerify = async () => {
    if (!editedOcrText.trim()) return
    setNpraLoading(true)
    setError(null)
    try {
      const result = await verifyNpra(editedOcrText, ocrResult?.raw_text)
      onNpraResult(result)
      setStep('npra-done')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setNpraLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="step-badge">1</span>
        <span>Medicine Label</span>
        <span className="ml-auto">
          <span className="step-badge">2</span>
          <span className="ml-1 text-[var(--text-muted)]">Patient Case</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Image upload ─────────────────────────── */}
        <UploadZone
          id="medicine-label-upload"
          label="Medicine Label Image"
          accept="image/*"
          icon={<ImageIcon />}
          hint="PNG, JPG, WebP supported"
          onFile={handleImageFile}
          fileName={imageFile?.name}
        />

        {/* Image preview */}
        {previewUrl && (
          <div className="relative w-full h-36 rounded-xl overflow-hidden border border-[var(--border)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Medicine label preview" className="w-full h-full object-contain" />
          </div>
        )}

        {/* Run OCR button */}
        {imageFile && step !== 'ocr-done' && step !== 'npra-done' && (
          <button
            id="run-ocr-btn"
            className="btn-primary w-full"
            onClick={runOcr}
            disabled={step === 'ocr-loading'}
          >
            {step === 'ocr-loading' ? <><Spinner size={14} /> Extracting text…</> : '🔍 Run OCR'}
          </button>
        )}

        {/* OCR result */}
        {ocrResult && (
          <div>
            <SectionTitle>Extracted Text (editable)</SectionTitle>
            <textarea
              id="ocr-text-area"
              value={editedOcrText}
              onChange={e => setEditedOcrText(e.target.value)}
              rows={5}
              className="w-full rounded-xl text-xs p-3 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--teal)]"
              style={{
                background: 'rgba(15,22,41,0.8)',
                border: '1px solid var(--border-bright)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}
              placeholder="Extracted OCR text…"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Edit the text above to correct OCR errors before searching NPRA.
            </p>
          </div>
        )}

        {/* Verify NPRA button */}
        {(step === 'ocr-done' || step === 'npra-done') && (
          <button
            id="verify-npra-btn"
            className="btn-primary w-full"
            onClick={runNpraVerify}
            disabled={npraLoading || !editedOcrText.trim()}
          >
            {npraLoading ? <><Spinner size={14} /> Searching NPRA…</> : '🛡 Verify with NPRA'}
          </button>
        )}

        {step === 'npra-done' && (
          <div className="flex items-center gap-2 text-xs text-[var(--emerald)]">
            <span>✓</span><span>NPRA lookup complete — see middle panel</span>
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        <GlowDivider />

        {/* ── Patient PDF ──────────────────────────── */}
        <UploadZone
          id="patient-pdf-upload"
          label="Patient Case PDF"
          accept="application/pdf"
          icon={<PdfIcon />}
          hint="PDF only — patient history, allergies, medication"
          onFile={onPatientFile}
          fileName={patientFileName}
        />

        {patientLoading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Spinner size={14} /><span>Indexing patient PDF…</span>
          </div>
        )}

        {patientIndexed && !patientLoading && (
          <div className="flex items-center gap-2 text-xs text-[var(--emerald)]">
            <span>✓</span><span>Patient case indexed in ChromaDB</span>
          </div>
        )}
      </div>
    </div>
  )
}
