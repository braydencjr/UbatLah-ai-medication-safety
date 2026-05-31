'use client'

import { useCallback, useState } from 'react'

interface UploadZoneProps {
  id: string
  label: string
  accept: string
  icon: React.ReactNode
  hint: string
  onFile: (file: File) => void
  fileName?: string
  disabled?: boolean
}

export default function UploadZone({
  id, label, accept, icon, hint, onFile, fileName, disabled
}: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
        {label}
      </p>
      <label
        htmlFor={id}
        className={`upload-zone block ${dragging ? 'dragging' : ''} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <div className="text-[var(--teal)] opacity-80">{icon}</div>
          {fileName ? (
            <>
              <p className="text-xs font-semibold text-[var(--teal)] truncate max-w-full px-2">
                ✓ {fileName}
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">Click to replace</p>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)]">
                Drop file here or <span className="text-[var(--teal)] underline">browse</span>
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">{hint}</p>
            </>
          )}
        </div>
      </label>
    </div>
  )
}
