'use client'

import { useState } from 'react'
import { Spinner, EmptyState, ErrorBanner, FieldRow, StatusBadge, GlowDivider, SectionTitle } from './ui'
import { getOpenFda, NpraResult, OpenFdaResult, DrugLabelInfo, DRUG_FIELD_LABELS, HIGH_PRIORITY_FIELDS } from '@/lib/api'

interface MiddlePanelProps {
  npraResult: NpraResult | null
}

const ShieldIcon = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"/>
  </svg>
)

const PillIcon = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/>
  </svg>
)

function DrugSection({ label, content, priority }: { label: string; content: string; priority: boolean }) {
  const truncated = content.length > 600 ? content.slice(0, 600) + '…' : content
  return (
    <details>
      <summary>
        <span className="flex items-center gap-2">
          {priority && <span className="text-[var(--rose)] text-[10px]">⚠</span>}
          {label}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] ml-auto pl-2">▾</span>
      </summary>
      <p style={{ padding: '8px', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {truncated}
      </p>
    </details>
  )
}

export default function MiddlePanel({ npraResult }: MiddlePanelProps) {
  const [fdaLoading, setFdaLoading] = useState(false)
  const [fdaResult, setFdaResult] = useState<OpenFdaResult | null>(null)
  const [fdaError, setFdaError] = useState<string | null>(null)

  const fetchOpenFda = async () => {
    setFdaLoading(true)
    setFdaError(null)
    try {
      const result = await getOpenFda()
      setFdaResult(result)
    } catch (e: any) {
      setFdaError(e.message)
    } finally {
      setFdaLoading(false)
    }
  }

  const npra = npraResult?.npra_info
  const hasFda = fdaResult?.drug_label_info && Object.keys(fdaResult.drug_label_info).length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <ShieldIcon />
        <span>NPRA Verification</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── NPRA Card ─────────────────────────────── */}
        {!npraResult && (
          <EmptyState icon="🛡" text="Run OCR and NPRA verification from the left panel" />
        )}

        {npraResult && !npraResult.found && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="text-3xl">🔍</span>
            <p className="text-xs text-[var(--amber)]">No matching product found in NPRA database</p>
            <p className="text-[10px] text-[var(--text-muted)] max-w-[200px]">
              {npraResult.message}
            </p>
          </div>
        )}

        {npra && (
          <div className="glass-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[var(--text-primary)] leading-snug">
                  {npra.product}
                </p>
                {npra.registration_no && (
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">
                    {npra.registration_no}
                  </p>
                )}
              </div>
              <StatusBadge status={npra.status} />
            </div>

            <GlowDivider />

            <FieldRow label="Holder" value={npra.holder} />
            <FieldRow label="Manufacturer" value={npra.manufacturer} />
            <FieldRow label="Description" value={npra.description} />
            <FieldRow label="Active Ingredient" value={npra.active_ingredient} />
            <FieldRow label="Generic Name" value={npra.generic_name} />
            <FieldRow
              label="Match Confidence"
              value={npra.match_score !== undefined ? `${npra.match_score}%` : undefined}
            />
            <FieldRow label="Why this score" value={npra.match_reason} />
          </div>
        )}

        {/* ── OpenFDA Section ───────────────────────── */}
        {npra && (
          <>
            <GlowDivider />
            <div className="flex items-center gap-2 panel-header" style={{ padding: '8px 0', borderBottom: 'none' }}>
              <PillIcon />
              <span>OpenFDA Drug Label</span>
            </div>

            {!fdaResult && (
              <button
                id="fetch-openfda-btn"
                className="btn-secondary w-full"
                onClick={fetchOpenFda}
                disabled={fdaLoading}
              >
                {fdaLoading
                  ? <><Spinner size={14} /> Fetching drug label…</>
                  : '💊 Fetch Drug Label from FDA'}
              </button>
            )}

            {fdaError && <ErrorBanner message={fdaError} />}

            {fdaResult && !hasFda && (
              <p className="text-xs text-[var(--amber)] text-center py-4">
                No drug label data found in openFDA for this ingredient.
              </p>
            )}

            {hasFda && (
              <>
                <div className="glass-card p-3">
                  <SectionTitle>Summary</SectionTitle>
                  <FieldRow label="Brand" value={fdaResult.drug_label_info!.openfda_brand_name} />
                  <FieldRow label="Generic" value={fdaResult.drug_label_info!.openfda_generic_name} />
                  <FieldRow label="Manufacturer" value={fdaResult.drug_label_info!.openfda_manufacturer_name} />
                  <FieldRow label="Purpose" value={fdaResult.drug_label_info!.purpose} />
                </div>

                <div className="drug-section space-y-1">
                  <SectionTitle>Full Label Details</SectionTitle>
                  {Object.entries(fdaResult.drug_label_info!).map(([key, value]) => {
                    if (['openfda_brand_name','openfda_generic_name','openfda_manufacturer_name','purpose'].includes(key)) return null
                    const label = DRUG_FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
                    const priority = HIGH_PRIORITY_FIELDS.includes(key)
                    return (
                      <DrugSection
                        key={key}
                        label={label}
                        content={value}
                        priority={priority}
                      />
                    )
                  })}
                </div>

                <button
                  id="refetch-openfda-btn"
                  className="btn-secondary w-full text-[10px]"
                  onClick={fetchOpenFda}
                  disabled={fdaLoading}
                >
                  ↻ Refresh
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
