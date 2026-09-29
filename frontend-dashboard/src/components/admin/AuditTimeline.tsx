import type { AuditEntry } from '../../api/mock'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export default function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p style={{ padding: 16, opacity: 0.6 }}>Koi audit history nahi hai.</p>
  }

  const sorted = [...entries].sort((a, b) => +new Date(a.at) - +new Date(b.at))

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid #c7d2fe' }}>
      {sorted.map((e) => (
        <li key={e.id} style={{ position: 'relative', padding: '0 0 16px 16px' }}>
          <span
            style={{
              position: 'absolute',
              left: -6,
              top: 4,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#6366f1',
            }}
          />
          <div style={{ fontWeight: 600 }}>{e.action}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {e.actor} · {formatDate(e.at)}
          </div>
          {e.note && <div style={{ fontSize: 13, marginTop: 4 }}>“{e.note}”</div>}
        </li>
      ))}
    </ol>
  )
}