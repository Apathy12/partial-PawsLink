import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import QRCode from 'qrcode'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { parseQrText } from './lib/format'
import type { PublicListing } from './lib/types'
import { ageLabel, sexLabel, speciesLabel } from './lib/format'

export function Pill({ children, kind = '' }: { children: ReactNode; kind?: string }) {
  return <span className={'pill ' + (kind ? 'pill-' + kind : '')}>{children}</span>
}

export function Notice({ kind, children }: { kind: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <div className={'notice notice-' + kind}>{children}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function PawMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" focusable="false">
      <ellipse cx="18" cy="16" rx="5" ry="8" transform="rotate(-22 18 16)" />
      <ellipse cx="31" cy="11" rx="5" ry="8" />
      <ellipse cx="44" cy="16" rx="5" ry="8" transform="rotate(22 44 16)" />
      <ellipse cx="53" cy="29" rx="4" ry="7" transform="rotate(34 53 29)" />
      <path d="M31 27c-8 0-11 7-16 12-3 3-4 8-2 12 3 6 10 7 18 4 8 3 15 2 18-4 2-4 1-9-2-12-5-5-8-12-16-12Z" />
    </svg>
  )
}

export function registryPill(status: string) {
  if (status === 'approved') return <Pill kind="ok">Approved</Pill>
  if (status === 'pending') return <Pill kind="wait">Waiting for CAVD</Pill>
  return <Pill kind="bad">Rejected</Pill>
}

export function listingPill(status: string) {
  if (status === 'approved') return <Pill kind="ok">Listing approved</Pill>
  if (status === 'pending') return <Pill kind="wait">Waiting for CAVD</Pill>
  if (status === 'rejected') return <Pill kind="bad">Listing rejected</Pill>
  return <Pill>Closed</Pill>
}

export function appPill(status: string) {
  if (status === 'approved') return <Pill kind="ok">Approved</Pill>
  if (status === 'pending') return <Pill kind="wait">Waiting for CAVD</Pill>
  return <Pill kind="bad">Declined</Pill>
}

export function sourcePill(source: string) {
  return source === 'shelter' ? <Pill kind="shelter">CAVD shelter</Pill> : <Pill kind="owner">Owner listing</Pill>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  )
}

export function Photo({ url, name, className }: { url?: string | null; name: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (url && failedUrl !== url) return <img src={url} alt={name} className={className} onError={() => setFailedUrl(url)} />
  return <span className="photo-fallback">No photo</span>
}

export function ListingCard({ row, href, actions }: { row: PublicListing; href: string; actions?: ReactNode }) {
  return (
    <article className="pet-card">
      <div className="pet-photo">
        <Photo url={row.photo_url} name={row.name} />
      </div>
      <div className="pet-body">
        <h3>{row.name}</h3>
        <div className="pet-meta">{speciesLabel(row.species)} · {ageLabel(row.birth_date)} · {sexLabel(row.sex)}</div>
        {sourcePill(row.source)}
        <NavLink className="record-link" to={href} aria-label={'View record for ' + row.name}>View record</NavLink>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </div>
    </article>
  )
}

export function SaveListingButton({ saved, busy, disabled, onToggle }: {
  saved: boolean; busy?: boolean; disabled?: boolean; onToggle: () => void
}) {
  return <button className="btn btn-sm btn-outline" type="button" aria-pressed={saved}
    disabled={disabled || busy} onClick={onToggle}>{busy ? 'Saving…' : saved ? 'Saved ♥' : 'Save pet ♡'}</button>
}

export function QrBlock({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    QRCode.toCanvas(ref.current, value, {
      width: 180, margin: 4,
      color: { dark: '#18251D', light: '#ffffff' }
    }).catch(() => {})
  }, [value])
  return (
    <div className="qr-block">
      <div className="qr-frame"><canvas ref={ref} width={180} height={180} role="img" aria-label="QR code for this pet's public record" /></div>
      <div className="qr-url">{value}</div>
    </div>
  )
}

export function Scanner({ onSlug }: { onSlug: (slug: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cb = useRef(onSlug)
  cb.current = onSlug
  const [err, setErr] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let stop = false
    let controls: { stop: () => void } | undefined
    ;(async () => {
      try {
        if (!videoRef.current) return
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (stop || !result) return
          const slug = parseQrText(result.getText())
          if (slug) cb.current(slug)
        })
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Camera is not available.')
      }
    })()
    return () => {
      stop = true
      controls?.stop()
    }
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    const slug = parseQrText(manual)
    if (slug) onSlug(slug)
    else setErr('Enter an 8-character tag or a PawsLink profile URL.')
  }

  return (
    <div>
      <div className="video-wrap"><video ref={videoRef} muted playsInline /></div>
      {err ? <Notice kind="warn">{err} On a phone, open this page over HTTPS and allow the camera.</Notice> : null}
      <form onSubmit={submit} style={{ marginTop: '1rem' }}>
        <Field label="Or type the tag / URL">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="e.g. k7n2p9qx" />
        </Field>
        <button className="btn" type="submit">Open</button>
      </form>
    </div>
  )
}

export function ToastHost({ toasts }: { toasts: { id: number; kind: string; text: string }[] }) {
  return (
    <div id="toasts" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}
    </div>
  )
}

let toastSeq = 1
export function useToasts() {
  const [toasts, setToasts] = useState<{ id: number; kind: string; text: string }[]>([])
  function push(text: string, kind = 'ok') {
    const id = toastSeq++
    setToasts(t => [...t.slice(-2), { id, kind, text }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }
  return { toasts, push, ok: (t: string) => push(t, 'ok'), bad: (t: string) => push(t, 'bad') }
}

type NavItem = { to: string; label: string; end?: boolean; count?: number }

export function CivicFrame({ children, nav = [], serviceName = 'Pet registry & adoption', action, variant = 'public' }: {
  children: ReactNode
  nav?: NavItem[]
  serviceName?: string
  action?: ReactNode
  variant?: string
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('pawslink-theme', next) } catch { /* Theme still works for this visit. */ }
    setTheme(next)
  }

  return (
    <div className={'site site-' + variant}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar">
        <div className="chrome-inner">
          <NavLink to="/" className="brand" aria-label="PawsLink prototype home">
            <span className="brand-mark"><PawMark /></span>
            <span className="brand-copy"><span className="wordmark">PawsLink</span><span className="brand-subtitle">A caring home starts here</span></span>
          </NavLink>
          <div className="topbar-actions">
            <span className="city-name">Butuan City · CAVD concept</span>
            <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
              {theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg>}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            {action}
          </div>
        </div>
      </header>
      <div className={'servicebar' + (nav.length > 3 ? ' has-mobile-menu' : '')}>
        <div className="chrome-inner">
          <span className="service-name">{serviceName}</span>
          <nav className="service-nav" aria-label="Service navigation">
            {nav.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => isActive ? 'active' : ''}>
                {n.label}{n.count ? <span className="count">{n.count}</span> : null}
              </NavLink>
            ))}
          </nav>
          {nav.length > 3 ? <details className="service-menu">
            <summary>Browse sections <span aria-hidden="true">⌄</span></summary>
            <nav className="service-menu-list" aria-label="Mobile service navigation">
              {nav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => isActive ? 'active' : ''}>
                {n.label}{n.count ? <span className="count">{n.count}</span> : null}
              </NavLink>)}
            </nav>
          </details> : null}
        </div>
      </div>
      <div className="phase-strip"><div className="chrome-inner"><strong>Capstone prototype</strong> — Barangay Ampayon / CAVD Tiniwisan</div></div>
      <main id="main-content" className="layout" tabIndex={-1}>{children}</main>
      <footer className="footer-note"><div className="chrome-inner">
        <p>PawsLink · Capstone prototype</p><p>For demonstration purposes only.</p>
      </div></footer>
    </div>
  )
}

export function Shell({
  who, roleLabel, nav, children, onSignOut, extra, showIdentity = true
}: {
  who: string
  roleLabel: string
  nav: NavItem[]
  children: ReactNode
  onSignOut: () => void
  extra?: ReactNode
  showIdentity?: boolean
}) {
  return (
    <CivicFrame
      variant={nav[0]?.to === '/office' ? 'office' : nav[0]?.to === '/vet' ? 'vet' : 'user'}
      serviceName={nav[0]?.to === '/office' ? 'CAVD office' : nav[0]?.to === '/vet' ? 'Veterinary service' : 'My registry'}
      nav={nav}
      action={<button className="header-action" type="button" onClick={onSignOut}>Log out</button>}
    >
      {showIdentity ? <div className="rolebar">
        <span className="who">{who}</span>
        <span>{roleLabel}</span>
        {extra ? <span className="role-description">{extra}</span> : null}
      </div> : null}
      {children}
    </CivicFrame>
  )
}
