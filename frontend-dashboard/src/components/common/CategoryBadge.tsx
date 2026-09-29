import { CATEGORY_LABELS } from '../../api/mock'
import type { Category } from '../../api/mock'

const COLORS: Record<Category, { bg: string; fg: string }> = {
  heavy_rain: { bg: '#dbeafe', fg: '#1e40af' },
  flood: { bg: '#cffafe', fg: '#155e75' },
  heatwave: { bg: '#fee2e2', fg: '#991b1b' },
  cold_wave: { bg: '#e0f2fe', fg: '#075985' },
  cyclone: { bg: '#ede9fe', fg: '#5b21b6' },
  thunderstorm: { bg: '#fef3c7', fg: '#92400e' },
  hailstorm: { bg: '#e2e8f0', fg: '#334155' },
  fog: { bg: '#f1f5f9', fg: '#475569' },
}

export default function CategoryBadge({ category }: { category: Category }) {
  const c = COLORS[category]
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap' }}>
      {CATEGORY_LABELS[category]}
    </span>
  )
}