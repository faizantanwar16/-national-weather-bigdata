import type { TrustBreakdown as TrustData } from '../../api/mock'

const ROWS: { key: keyof TrustData; label: string; weight: number }[] = [
  { key: 'weatherCorrelation', label: 'Weather correlation', weight: 30 },
  { key: 'locationMatch', label: 'Location match', weight: 25 },
  { key: 'reporterHistory', label: 'Reporter history', weight: 15 },
  { key: 'mediaEvidence', label: 'Media evidence', weight: 15 },
  { key: 'duplicateCheck', label: 'Duplicate check', weight: 15 },
]

const barColor = (v: number) => (v >= 70 ? '#16a34a' : v >= 40 ? '#eab308' : '#dc2626')

interface Props {
  breakdown: TrustData
  trustScore: number
}

export default function TrustBreakdown({ breakdown, trustScore }: Props) {
  return (
    <div>
      <p style={{ margin: '0 0 12px' }}>
        Overall trust score: <b style={{ color: barColor(trustScore), fontSize: 20 }}>{trustScore}</b> / 100
      </p>
      {ROWS.map((r) => {
        const value = breakdown[r.key]
        return (
          <div key={r.key} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{r.label} <small style={{ opacity: 0.6 }}>({r.weight}% weight)</small></span>
              <b>{value}</b>
            </div>
            <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8 }}>
              <div style={{ width: `${value}%`, background: barColor(value), height: 8, borderRadius: 4 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}