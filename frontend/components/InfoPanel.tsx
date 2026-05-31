'use client'

import { useState } from 'react'
import { getOpenFda, NpraInfo, NpraResult, OpenFdaResult, DRUG_FIELD_LABELS, HIGH_PRIORITY_FIELDS } from '@/lib/api'

interface InfoPanelProps {
  npraResult: NpraResult | null
}

const SIMPLE_LABELS: Record<string, string> = {
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

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

function DrugSection({ fieldKey, content }: { fieldKey: string; content: string }) {
  const label = SIMPLE_LABELS[fieldKey] ?? fieldKey.replace(/_/g, ' ')
  const isWarning = HIGH_PRIORITY_FIELDS.includes(fieldKey)
  const short = content.length > 500 ? content.slice(0, 500) + '…' : content
  return (
    <details>
      <summary>
        <span className="flex items-center gap-2">
          {isWarning && <span style={{ color: 'var(--amber)', fontSize: 11 }}>⚠</span>}
          {label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--sand)', marginLeft: 'auto', paddingLeft: 8 }}>▾</span>
      </summary>
      <p>{short}</p>
    </details>
  )
}

// ── Verification status banner ─────────────────────────────────────────────
type VerifStatus = 'VERIFIED' | 'PROBABLE' | 'UNVERIFIED'

const VERIF_CONFIG: Record<VerifStatus, {
  icon: string
  label: string
  sublabel: string
  bg: string
  border: string
  color: string
}> = {
  VERIFIED: {
    icon: '🛡️',
    label: 'Registered & Verified',
    sublabel: 'This product is registered with the Malaysian NPRA database and the label details match.',
    bg: 'rgba(90,132,98,0.08)',
    border: 'rgba(90,132,98,0.25)',
    color: 'var(--sage-deep)',
  },
  PROBABLE: {
    icon: '⚠️',
    label: 'Found — Low Confidence',
    sublabel: 'A product was found in the NPRA database but the match confidence is low. Verify with your pharmacist.',
    bg: 'rgba(200,133,74,0.08)',
    border: 'rgba(200,133,74,0.25)',
    color: 'var(--amber)',
  },
  UNVERIFIED: {
    icon: '🚫',
    label: 'NOT Registered / Unverified',
    sublabel: 'This product was NOT found in the Malaysian NPRA database. It may be unregistered, counterfeit, or illegally sold.',
    bg: 'rgba(190,60,60,0.07)',
    border: 'rgba(190,60,60,0.22)',
    color: '#c03c3c',
  },
}

function VerificationBanner({ status }: { status: VerifStatus }) {
  const cfg = VERIF_CONFIG[status]
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 16 }}>{cfg.icon}</span>
        <span className="text-xs font-semibold tracking-wide" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: cfg.color, opacity: 0.85 }}>
        {cfg.sublabel}
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function InfoPanel({ npraResult }: InfoPanelProps) {
  const [fdaLoading, setFdaLoading] = useState(false)
  const [fdaResult, setFdaResult] = useState<OpenFdaResult | null>(null)
  const [fdaError, setFdaError] = useState<string | null>(null)

  const fetchFda = async () => {
    setFdaLoading(true); setFdaError(null)
    try {
      const r = await getOpenFda()
      setFdaResult(r)
    } catch (e: any) {
      setFdaError('Could not load drug information. Please try again.')
    } finally {
      setFdaLoading(false)
    }
  }

  const npra = npraResult?.npra_info
  const hasFda = !!(fdaResult?.drug_label_info && Object.keys(fdaResult.drug_label_info).length > 0)

  // Determine what verification status to show
  const verifStatus: VerifStatus =
    !npraResult || !npraResult.found
      ? 'UNVERIFIED'
      : (npra?.verification_status as VerifStatus | undefined) ?? 'PROBABLE'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(196,185,170,0.18)' }}>
        <h2 className="font-serif text-base font-medium" style={{ color: 'var(--warm-dark)' }}>
          Medicine details
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--warm-gray)' }}>
          Verification and drug information
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

        {/* Empty state */}
        {!npraResult && (
          <div className="empty-state mt-6">
            <div className="empty-state-icon">🏥</div>
            <p className="text-sm font-serif" style={{ color: 'var(--warm-dark)' }}>No medicine loaded</p>
            <p className="text-xs" style={{ color: 'var(--warm-gray)' }}>
              Details will appear here after you upload and check your medicine.
            </p>
          </div>
        )}

        {/* Not found in NPRA */}
        {npraResult && !npraResult.found && (
          <div className="space-y-3 animate-in">
            <VerificationBanner status="UNVERIFIED" />
            <div className="card-sm p-4 text-center space-y-1">
              <p className="text-[11px]" style={{ color: 'var(--warm-gray)' }}>
                {npraResult.message ?? 'No matching product found in the NPRA database.'}
              </p>
              {npraResult.normalized_query && (
                <p className="text-[10px] font-mono" style={{ color: 'var(--sand)' }}>
                  Searched for: {npraResult.normalized_query}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Found */}
        {npra && (
          <div className="animate-in space-y-4">

            {/* Prominent verification status — always first */}
            <VerificationBanner status={verifStatus} />

            {/* Product card */}
            <div className="card-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium leading-snug" style={{ color: 'var(--warm-dark)' }}>
                    {npra.product}
                  </p>
                  {npra.registration_no && (
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--sand)' }}>
                      Reg. {npra.registration_no}
                    </p>
                  )}
                </div>
                {/* NPRA registration status (Approved / Cancelled / etc.) */}
                <span
                  className="flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full"
                  style={{
                    background: npra.status?.toLowerCase().includes('approved')
                      ? 'rgba(90,132,98,0.12)' : 'rgba(200,133,74,0.12)',
                    color: npra.status?.toLowerCase().includes('approved')
                      ? 'var(--sage-deep)' : 'var(--amber)',
                  }}
                >
                  {npra.status ?? 'Unknown'}
                </span>
              </div>

              <div className="divider mt-3" />

              <Field label="Made by" value={npra.manufacturer} />
              <Field label="Company" value={npra.holder} />
              <Field label="Type" value={npra.description} />
              <Field label="Active ingredient" value={npra.active_ingredient?.split('[')[0].trim()} />

              {/* Match confidence meter */}
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px]" style={{ color: 'var(--warm-gray)' }}>
                    Match confidence
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--sand)' }}>
                    {Math.round(npra.match_score)}%
                  </span>
                </div>
                <div
                  className="rounded-full overflow-hidden"
                  style={{ height: 4, background: 'rgba(196,185,170,0.18)' }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${npra.match_score}%`,
                      background: npra.match_score >= 85
                        ? 'var(--sage-deep)'
                        : npra.match_score >= 65
                        ? 'var(--amber)'
                        : '#c03c3c',
                    }}
                  />
                </div>
                {npra.match_reason && (
                  <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--warm-gray)' }}>
                    {npra.match_reason}
                  </p>
                )}
              </div>
            </div>

            {/* Load drug info */}
            {!fdaResult && (
              <button
                id="load-drug-info-btn"
                className="btn btn-outline w-full"
                onClick={fetchFda}
                disabled={fdaLoading}
              >
                {fdaLoading
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Loading drug info…</>
                  : 'Load full drug information'}
              </button>
            )}

            {fdaError && (
              <div className="inline-error">{fdaError}</div>
            )}

            {/* Drug info sections */}
            {hasFda && (
              <div className="animate-in space-y-3">
                <div className="divider" />
                <p className="section-label">Drug information</p>

                <div className="card-sm p-4 space-y-1">
                  <Field label="Brand" value={fdaResult!.drug_label_info!.openfda_brand_name} />
                  <Field label="Generic" value={fdaResult!.drug_label_info!.openfda_generic_name} />
                  <Field label="What it does" value={fdaResult!.drug_label_info!.purpose} />
                </div>

                <div className="drug-details space-y-1">
                  {Object.entries(fdaResult!.drug_label_info!).map(([key, val]) => {
                    if (['openfda_brand_name','openfda_generic_name','openfda_manufacturer_name','purpose'].includes(key)) return null
                    return <DrugSection key={key} fieldKey={key} content={val} />
                  })}
                </div>

                <button
                  className="btn btn-outline w-full text-xs"
                  onClick={fetchFda}
                  disabled={fdaLoading}
                  style={{ padding: '8px 14px' }}
                >
                  ↻ Reload
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


interface InfoPanelProps {
  npraResult: NpraResult | null
}

// Human-readable label overrides — no jargon
const SIMPLE_LABELS: Record<string, string> = {
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

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

function DrugSection({ fieldKey, content }: { fieldKey: string; content: string }) {
  const label = SIMPLE_LABELS[fieldKey] ?? fieldKey.replace(/_/g, ' ')
  const isWarning = HIGH_PRIORITY_FIELDS.includes(fieldKey)
  const short = content.length > 500 ? content.slice(0, 500) + '…' : content
  return (
    <details>
      <summary>
        <span className="flex items-center gap-2">
          {isWarning && <span style={{ color: 'var(--amber)', fontSize: 11 }}>⚠</span>}
          {label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--sand)', marginLeft: 'auto', paddingLeft: 8 }}>▾</span>
      </summary>
      <p>{short}</p>
    </details>
  )
}

export default function InfoPanel({ npraResult }: InfoPanelProps) {
  const [fdaLoading, setFdaLoading] = useState(false)
  const [fdaResult, setFdaResult] = useState<OpenFdaResult | null>(null)
  const [fdaError, setFdaError] = useState<string | null>(null)

  const fetchFda = async () => {
    setFdaLoading(true); setFdaError(null)
    try {
      const r = await getOpenFda()
      setFdaResult(r)
    } catch (e: any) {
      setFdaError('Could not load drug information. Please try again.')
    } finally {
      setFdaLoading(false)
    }
  }

  const npra = npraResult?.npra_info
  const hasFda = !!(fdaResult?.drug_label_info && Object.keys(fdaResult.drug_label_info).length > 0)
  const isApproved = npra?.status?.toLowerCase().includes('approved')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(196,185,170,0.18)' }}>
        <h2 className="font-serif text-base font-medium" style={{ color: 'var(--warm-dark)' }}>
          Medicine details
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--warm-gray)' }}>
          Verification and drug information
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

        {/* Empty */}
        {!npraResult && (
          <div className="empty-state mt-6">
            <div className="empty-state-icon">🏥</div>
            <p className="text-sm font-serif" style={{ color: 'var(--warm-dark)' }}>No medicine loaded</p>
            <p className="text-xs" style={{ color: 'var(--warm-gray)' }}>
              Details will appear here after you upload and check your medicine.
            </p>
          </div>
        )}

        {/* Not found */}
        {npraResult && !npraResult.found && (
          <div className="card-sm p-4 text-center space-y-2">
            <p className="text-2xl">🔍</p>
            <p className="text-sm font-medium" style={{ color: 'var(--amber)' }}>Medicine not found</p>
            <p className="text-[11px]" style={{ color: 'var(--warm-gray)' }}>
              This product was not found in the Malaysian medicine database. It may be unregistered or the photo was unclear.
            </p>
          </div>
        )}

        {/* Found */}
        {npra && (
          <div className="animate-in space-y-4">
            {/* Approval card */}
            <div className="card-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium leading-snug" style={{ color: 'var(--warm-dark)' }}>
                    {npra.product}
                  </p>
                  {npra.registration_no && (
                    <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--sand)' }}>
                      Reg. {npra.registration_no}
                    </p>
                  )}
                </div>
                <span className={`badge ${isApproved ? 'badge-approved' : 'badge-warning'} flex-shrink-0`}>
                  {isApproved ? 'Approved' : npra.status ?? 'Unknown'}
                </span>
              </div>

              <div className="divider mt-3" />

              <Field label="Made by" value={npra.manufacturer} />
              <Field label="Company" value={npra.holder} />
              <Field label="Type" value={npra.description} />
              <Field label="Active ingredient" value={npra.active_ingredient?.split('[')[0].trim()} />
              <Field label="Why this score" value={npra.match_reason} />
            </div>

            {/* Approval status note */}
            <div
              className="rounded-xl px-4 py-3"
              style={{
                background: isApproved ? 'rgba(90,132,98,0.07)' : 'rgba(200,133,74,0.07)',
                border: `1px solid ${isApproved ? 'rgba(90,132,98,0.18)' : 'rgba(200,133,74,0.18)'}`,
              }}
            >
              <p className="text-[11px] leading-relaxed" style={{ color: isApproved ? 'var(--sage-deep)' : 'var(--amber)' }}>
                {isApproved
                  ? '✓ This medicine is registered and approved for sale in Malaysia.'
                  : "⚠ This medicine's registration status needs attention. Ask your pharmacist."}
              </p>
            </div>

            {/* Load drug info */}
            {!fdaResult && (
              <button
                id="load-drug-info-btn"
                className="btn btn-outline w-full"
                onClick={fetchFda}
                disabled={fdaLoading}
              >
                {fdaLoading
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Loading drug info…</>
                  : 'Load full drug information'}
              </button>
            )}

            {fdaError && (
              <div className="inline-error">{fdaError}</div>
            )}

            {/* Drug info sections */}
            {hasFda && (
              <div className="animate-in space-y-3">
                <div className="divider" />
                <p className="section-label">Drug information</p>

                {/* Top summary */}
                <div className="card-sm p-4 space-y-1">
                  <Field label="Brand" value={fdaResult!.drug_label_info!.openfda_brand_name} />
                  <Field label="Generic" value={fdaResult!.drug_label_info!.openfda_generic_name} />
                  <Field label="What it does" value={fdaResult!.drug_label_info!.purpose} />
                </div>

                {/* Collapsible sections */}
                <div className="drug-details space-y-1">
                  {Object.entries(fdaResult!.drug_label_info!).map(([key, val]) => {
                    if (['openfda_brand_name','openfda_generic_name','openfda_manufacturer_name','purpose'].includes(key)) return null
                    return <DrugSection key={key} fieldKey={key} content={val} />
                  })}
                </div>

                <button
                  className="btn btn-outline w-full text-xs"
                  onClick={fetchFda}
                  disabled={fdaLoading}
                  style={{ padding: '8px 14px' }}
                >
                  ↻ Reload
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
