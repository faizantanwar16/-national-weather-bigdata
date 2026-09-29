import { useState } from 'react'
import { mockApi } from '../../api/mock'
import type { Report } from '../../api/mock'

type Action = 'approve' | 'reject' | 'duplicate' | 'escalate'

const BUTTONS: { action: Action; label: string; color: string }[] = [
  { action: 'approve', label: 'Approve', color: '#16a34a' },
  { action: 'reject', label: 'Reject', color: '#dc2626' },
  { action: 'duplicate', label: 'Mark duplicate', color: '#6b7280' },
  { action: 'escalate', label: 'Escalate', color: '#3b82f6' },
]

interface Props {
  reportId: string
  onDone?: (updated: Report) => void
}

export default function ReviewActions({ reportId, onDone }: Props) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: Action) => {
    setBusy(action)
    setError(null)
    try {
      const updated = await mockApi.reviewReport(reportId, action, note.trim() || undefined)
      setNote('')
      onDone?.(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <textarea
        placeholder="Note (optional)"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy !== null}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {BUTTONS.map((b) => (
          <button
            key={b.action}
            onClick={() => run(b.action)}
            disabled={busy !== null}
            style={{ background: b.color, color: '#fff', border: 0, padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}
          >
            {busy === b.action ? 'Saving…' : b.label}
          </button>
        ))}
      </div>
      {error && <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
    </div>
  )
}