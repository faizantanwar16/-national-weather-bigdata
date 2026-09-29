// src/api/mock.ts
// Mock data + fake async API for the National Weather Big Data dashboard.
// Deterministic (seeded) so the UI looks the same on every reload.

/* ------------------------------ Types ------------------------------ */

export type Category =
  | 'heavy_rain'
  | 'flood'
  | 'heatwave'
  | 'cold_wave'
  | 'cyclone'
  | 'thunderstorm'
  | 'hailstorm'
  | 'fog'

export type Status = 'pending' | 'under_review' | 'approved' | 'rejected' | 'duplicate'
export type Severity = 'low' | 'medium' | 'high' | 'extreme'

export interface TrustBreakdown {
  locationMatch: number // 0-100
  weatherCorrelation: number
  reporterHistory: number
  mediaEvidence: number
  duplicateCheck: number
}

export interface AuditEntry {
  id: string
  at: string // ISO
  actor: string
  action: string
  note?: string
}

export interface Report {
  id: string
  trackingId: string
  category: Category
  severity: Severity
  status: Status
  description: string
  lat: number
  lng: number
  state: string
  district: string
  reportedAt: string // ISO
  trustScore: number // 0-100
  trustBreakdown: TrustBreakdown
  auditLog: AuditEntry[]
}

export interface ReportFilters {
  category?: Category | 'all'
  status?: Status | 'all'
  state?: string | 'all'
  severity?: Severity | 'all'
  minTrust?: number
  from?: string // ISO date
  to?: string
  search?: string
}

export interface NewReportInput {
  category: Category
  severity: Severity
  description: string
  lat: number
  lng: number
  state: string
  district: string
}

export interface Analytics {
  total: number
  byCategory: { category: Category; count: number }[]
  topStates: { state: string; count: number }[]
  timeSeries: { date: string; count: number }[]
  avgTrustScore: number
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'reviewer' | 'viewer'
  active: boolean
  lastLogin: string
}

export interface SystemConfig {
  autoApproveThreshold: number
  autoRejectThreshold: number
  duplicateRadiusKm: number
  duplicateWindowMinutes: number
}

/* --------------------------- Static lookups --------------------------- */

export const CATEGORIES: Category[] = [
  'heavy_rain', 'flood', 'heatwave', 'cold_wave',
  'cyclone', 'thunderstorm', 'hailstorm', 'fog',
]

export const CATEGORY_LABELS: Record<Category, string> = {
  heavy_rain: 'Heavy Rain',
  flood: 'Flood',
  heatwave: 'Heatwave',
  cold_wave: 'Cold Wave',
  cyclone: 'Cyclone',
  thunderstorm: 'Thunderstorm',
  hailstorm: 'Hailstorm',
  fog: 'Fog',
}

const STATUSES: Status[] = ['pending', 'under_review', 'approved', 'rejected', 'duplicate']
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'extreme']

// state, district, lat, lng
const PLACES: [string, string, number, number][] = [
  ['Maharashtra', 'Mumbai', 19.076, 72.8777],
  ['Maharashtra', 'Pune', 18.5204, 73.8567],
  ['Maharashtra', 'Nagpur', 21.1458, 79.0882],
  ['Delhi', 'New Delhi', 28.6139, 77.209],
  ['Karnataka', 'Bengaluru', 12.9716, 77.5946],
  ['Tamil Nadu', 'Chennai', 13.0827, 80.2707],
  ['West Bengal', 'Kolkata', 22.5726, 88.3639],
  ['Gujarat', 'Ahmedabad', 23.0225, 72.5714],
  ['Rajasthan', 'Jaipur', 26.9124, 75.7873],
  ['Uttar Pradesh', 'Lucknow', 26.8467, 80.9462],
  ['Kerala', 'Kochi', 9.9312, 76.2673],
  ['Odisha', 'Bhubaneswar', 20.2961, 85.8245],
  ['Assam', 'Guwahati', 26.1445, 91.7362],
  ['Telangana', 'Hyderabad', 17.385, 78.4867],
  ['Bihar', 'Patna', 25.5941, 85.1376],
  ['Punjab', 'Ludhiana', 30.9, 75.8573],
]

export const STATES = Array.from(new Set(PLACES.map((p) => p[0]))).sort()

const DESCRIPTIONS: Record<Category, string[]> = {
  heavy_rain: ['Continuous heavy rain for 3 hours, roads waterlogged.', 'Very intense downpour, visibility very low.'],
  flood: ['Water entering ground-floor homes near the river.', 'Street flooded knee-deep, vehicles stuck.'],
  heatwave: ['Temperature feels above 45°C, people avoiding outdoors.', 'Extreme heat, hot winds since morning.'],
  cold_wave: ['Very cold morning, temperature dropped sharply.', 'Cold wave conditions, people using bonfires.'],
  cyclone: ['Strong winds and heavy rain, trees uprooted.', 'Cyclone warning in area, sea very rough.'],
  thunderstorm: ['Loud thunder and lightning, power cut in area.', 'Sudden thunderstorm with strong gusts.'],
  hailstorm: ['Hailstones the size of marbles damaging crops.', 'Short but heavy hailstorm, car windshields cracked.'],
  fog: ['Dense fog, visibility under 50 metres.', 'Heavy fog on highway, traffic very slow.'],
}

/* ------------------------- Seeded random helpers ------------------------- */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(2026)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const between = (min: number, max: number) => Math.round(min + rand() * (max - min))

/* ------------------------------ Data build ------------------------------ */

function buildReport(i: number): Report {
  const [state, district, baseLat, baseLng] = pick(PLACES)
  const category = pick(CATEGORIES)
  const status = pick(STATUSES)
  const daysAgo = between(0, 29)
  const reportedAt = new Date(Date.now() - daysAgo * 86_400_000 - between(0, 86_400) * 1000).toISOString()

  const trustBreakdown: TrustBreakdown = {
    locationMatch: between(30, 100),
    weatherCorrelation: between(20, 100),
    reporterHistory: between(10, 100),
    mediaEvidence: between(0, 100),
    duplicateCheck: between(40, 100),
  }
  const b = trustBreakdown
  const trustScore = Math.round(
    b.locationMatch * 0.25 + b.weatherCorrelation * 0.3 + b.reporterHistory * 0.15 +
      b.mediaEvidence * 0.15 + b.duplicateCheck * 0.15,
  )

  const auditLog: AuditEntry[] = [
    { id: `a${i}-1`, at: reportedAt, actor: 'system', action: 'Report received' },
    {
      id: `a${i}-2`,
      at: new Date(new Date(reportedAt).getTime() + 30_000).toISOString(),
      actor: 'classifier',
      action: `Classified as ${CATEGORY_LABELS[category]}`,
    },
    {
      id: `a${i}-3`,
      at: new Date(new Date(reportedAt).getTime() + 60_000).toISOString(),
      actor: 'trust-engine',
      action: `Trust score computed: ${trustScore}`,
    },
  ]
  if (status === 'approved' || status === 'rejected') {
    auditLog.push({
      id: `a${i}-4`,
      at: new Date(new Date(reportedAt).getTime() + 3_600_000).toISOString(),
      actor: 'reviewer@nwb.gov.in',
      action: status === 'approved' ? 'Approved' : 'Rejected',
    })
  }

  return {
    id: `rep_${String(i + 1).padStart(4, '0')}`,
    trackingId: `NWB-${(100000 + i * 37).toString(36).toUpperCase()}`,
    category,
    severity: pick(SEVERITIES),
    status,
    description: pick(DESCRIPTIONS[category]),
    lat: +(baseLat + (rand() - 0.5) * 0.4).toFixed(5),
    lng: +(baseLng + (rand() - 0.5) * 0.4).toFixed(5),
    state,
    district,
    reportedAt,
    trustScore,
    trustBreakdown,
    auditLog,
  }
}

let reports: Report[] = Array.from({ length: 250 }, (_, i) => buildReport(i)).sort(
  (a, b) => +new Date(b.reportedAt) - +new Date(a.reportedAt),
)

let users: AdminUser[] = [
  { id: 'u1', name: 'Admin User', email: 'admin@nwb.gov.in', role: 'admin', active: true, lastLogin: new Date().toISOString() },
  { id: 'u2', name: 'Riya Sharma', email: 'riya@nwb.gov.in', role: 'reviewer', active: true, lastLogin: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'u3', name: 'Amit Verma', email: 'amit@nwb.gov.in', role: 'reviewer', active: false, lastLogin: new Date(Date.now() - 9 * 86_400_000).toISOString() },
  { id: 'u4', name: 'Neha Patil', email: 'neha@nwb.gov.in', role: 'viewer', active: true, lastLogin: new Date(Date.now() - 3 * 86_400_000).toISOString() },
]

let config: SystemConfig = {
  autoApproveThreshold: 80,
  autoRejectThreshold: 25,
  duplicateRadiusKm: 2,
  duplicateWindowMinutes: 60,
}

/* ------------------------------ Fake latency ------------------------------ */

const delay = <T,>(value: T, ms = 400): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))

/* ------------------------------ Public API ------------------------------ */

function applyFilters(list: Report[], f: ReportFilters = {}): Report[] {
  return list.filter((r) => {
    if (f.category && f.category !== 'all' && r.category !== f.category) return false
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.state && f.state !== 'all' && r.state !== f.state) return false
    if (f.severity && f.severity !== 'all' && r.severity !== f.severity) return false
    if (f.minTrust !== undefined && r.trustScore < f.minTrust) return false
    if (f.from && new Date(r.reportedAt) < new Date(f.from)) return false
    if (f.to && new Date(r.reportedAt) > new Date(f.to + 'T23:59:59')) return false
    if (f.search) {
      const q = f.search.toLowerCase()
      const hay = `${r.trackingId} ${r.description} ${r.district} ${r.state}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export const mockApi = {
  /* ---- Public dashboard ---- */
  getReports(filters?: ReportFilters) {
    return delay(applyFilters(reports, filters))
  },

  getReportById(id: string) {
    return delay(reports.find((r) => r.id === id) ?? null)
  },

  getReportByTrackingId(trackingId: string) {
    const t = trackingId.trim().toUpperCase()
    return delay(reports.find((r) => r.trackingId === t) ?? null)
  },

  getAnalytics(filters?: ReportFilters): Promise<Analytics> {
    const list = applyFilters(reports, filters)

    const byCat = new Map<Category, number>()
    const byState = new Map<string, number>()
    const byDay = new Map<string, number>()
    let trustSum = 0

    for (const r of list) {
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1)
      byState.set(r.state, (byState.get(r.state) ?? 0) + 1)
      const day = r.reportedAt.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + 1)
      trustSum += r.trustScore
    }

    return delay({
      total: list.length,
      byCategory: CATEGORIES.map((c) => ({ category: c, count: byCat.get(c) ?? 0 })),
      topStates: [...byState.entries()]
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      timeSeries: [...byDay.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      avgTrustScore: list.length ? Math.round(trustSum / list.length) : 0,
    })
  },

  /* ---- Citizen report ---- */
  submitReport(input: NewReportInput) {
    const i = reports.length
    const now = new Date().toISOString()
    const report: Report = {
      ...input,
      id: `rep_${String(i + 1).padStart(4, '0')}`,
      trackingId: `NWB-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      status: 'pending',
      reportedAt: now,
      trustScore: 50,
      trustBreakdown: { locationMatch: 50, weatherCorrelation: 50, reporterHistory: 50, mediaEvidence: 0, duplicateCheck: 100 },
      auditLog: [{ id: `a${i}-1`, at: now, actor: 'system', action: 'Report received' }],
    }
    reports = [report, ...reports]
    return delay(report, 700)
  },

  /* ---- Admin auth ---- */
  login(email: string, password: string) {
    const user = users.find((u) => u.email === email && u.active)
    if (!user || password !== 'admin123') {
      return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Invalid email or password')), 500))
    }
    return delay({ token: `mock-token-${user.id}`, user }, 500)
  },

  /* ---- Admin review ---- */
  getReviewQueue() {
    const queue = reports
      .filter((r) => r.status === 'pending' || r.status === 'under_review')
      .sort((a, b) => a.trustScore - b.trustScore)
    return delay(queue)
  },

  reviewReport(id: string, action: 'approve' | 'reject' | 'duplicate' | 'escalate', note?: string, actor = 'admin@nwb.gov.in') {
    const r = reports.find((x) => x.id === id)
    if (!r) return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Report not found')), 300))

    const map = { approve: 'approved', reject: 'rejected', duplicate: 'duplicate', escalate: 'under_review' } as const
    r.status = map[action]
    r.auditLog.push({
      id: `a-${id}-${r.auditLog.length + 1}`,
      at: new Date().toISOString(),
      actor,
      action: action.charAt(0).toUpperCase() + action.slice(1),
      note,
    })
    return delay(r, 500)
  },

  /* ---- Admin users & config ---- */
  getUsers() {
    return delay(users)
  },

  toggleUser(id: string) {
    users = users.map((u) => (u.id === id ? { ...u, active: !u.active } : u))
    return delay(users)
  },

  getConfig() {
    return delay(config)
  },

  updateConfig(patch: Partial<SystemConfig>) {
    config = { ...config, ...patch }
    return delay(config)
  },
}

export default mockApi