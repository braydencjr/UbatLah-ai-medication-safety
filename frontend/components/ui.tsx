'use client'

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <div
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  )
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const lower = status.toLowerCase()
  const cls = lower.includes('approved')
    ? 'status-approved'
    : lower.includes('warning') || lower.includes('suspend')
    ? 'status-warning'
    : lower.includes('cancel') || lower.includes('revok')
    ? 'status-danger'
    : 'status-approved'
  return (
    <span className={`${cls} text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide`}>
      {status}
    </span>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="section-title">{children}</p>
}

export function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 opacity-40">
      <div className="text-4xl">{icon}</div>
      <p className="text-xs text-[var(--text-muted)] text-center max-w-[180px]">{text}</p>
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-2 items-start p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
      <span className="flex-shrink-0 mt-0.5">⚠</span>
      <span>{message}</span>
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-2 items-start p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
      <span className="flex-shrink-0 mt-0.5">✓</span>
      <span>{message}</span>
    </div>
  )
}

export function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="field-row">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

export function GlowDivider() {
  return <div className="glow-divider" />
}
