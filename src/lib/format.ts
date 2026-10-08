const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = iso.slice(0, 10).split('-')
  if (d.length !== 3) return iso
  return `${Number(d[2])} ${MONTHS[Number(d[1]) - 1]} ${d[0]}`
}

export function ageMonths(birth: string) {
  const b = new Date(birth)
  const n = new Date()
  return Math.max(0, (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth()))
}

export function ageLabel(birth: string) {
  const m = ageMonths(birth)
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`
  const y = Math.floor(m / 12)
  const r = m % 12
  return `${y} year${y === 1 ? '' : 's'}${r ? ` ${r} mo` : ''}`
}

export function ageGroup(birth: string) {
  const m = ageMonths(birth)
  if (m < 12) return 'baby'
  if (m < 36) return 'young'
  if (m < 84) return 'adult'
  return 'senior'
}

export function speciesLabel(s: string) {
  if (s === 'dog') return 'Dog'
  if (s === 'cat') return 'Cat'
  return 'Other'
}

export function sizeLabel(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}

export function sexLabel(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}

export function sourceLabel(s: string) {
  return s === 'shelter' ? 'CAVD shelter' : 'Direct owner'
}

export function petLine(p: { breed: string | null; sex: string; size: string; birth_date: string }) {
  return `${p.breed || 'Unknown breed'} · ${sexLabel(p.sex)} · ${ageLabel(p.birth_date)} · ${sizeLabel(p.size)}`
}

export function homeFor(role: string) {
  if (role === 'cavd') return '/office'
  if (role === 'vet') return '/vet'
  return '/app'
}

export function assetUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

export function appUrl(path: string) {
  return new URL(assetUrl(path), window.location.origin).href
}

export function qrUrl(slug: string) {
  return appUrl(`/p/${slug}`)
}

export function parseQrText(text: string) {
  const t = text.trim()
  const m = t.match(/\/p\/([a-z0-9]{8})/i)
  if (m) return m[1].toLowerCase()
  if (/^[a-z0-9]{8}$/i.test(t)) return t.toLowerCase()
  return null
}
