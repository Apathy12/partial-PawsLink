import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { CLEARANCE_LABELS } from './lib/eligibility'
import type { Application, Pet, PublicListing, Visit } from './lib/types'
import { ageLabel, assetUrl, sexLabel, speciesLabel } from './lib/format'

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

export function clearancePill(status: Visit['clearance_status'] | null | undefined) {
  if (!status) return <Pill kind="neutral">No visit recorded</Pill>
  return <Pill kind={status === 'cleared' ? 'ok' : status === 'hold' ? 'hold' : 'neutral'}>{CLEARANCE_LABELS[status]}</Pill>
}

export function discoveryPill(path: Application['discovery_path']) {
  return path === 'match' ? <Pill kind="match">From Find My Match</Pill> : <Pill kind="neutral">From Direct Adoption</Pill>
}

export function originBadge(custodySource: Pet['custody_source']) {
  return custodySource === 'shelter' ? <Pill kind="origin-shelter">Shelter pet</Pill> : <Pill kind="origin-private">Private owner</Pill>
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

export function Pagination({ page, pageSize, total, onChange, label, disabled = false }: {
  page: number; pageSize: number; total: number; onChange: (page: number) => void; label: string; disabled?: boolean
}) {
  if (!total) return null
  const pages = Math.ceil(total / pageSize)
  return <nav className="pagination-row registry-pagination" aria-label={`${label} pages`}>
    <button className="btn btn-sm btn-outline" type="button" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>Previous</button>
    <span className="sub" aria-live="polite">Page {page + 1} of {pages} · {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} pet{total === 1 ? '' : 's'}</span>
    <button className="btn btn-sm btn-outline" type="button" disabled={disabled || page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>
}

export function Photo({ url, name, className }: { url?: string | null; name: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const imageUrl = url?.startsWith('/demo-pets/') ? assetUrl(url) : url
  if (imageUrl && failedUrl !== imageUrl) return <img src={imageUrl} alt={name} className={className} loading="lazy" decoding="async" onError={() => setFailedUrl(imageUrl)} />
  return (
    <span className="photo-fallback" role="img" aria-label={name + ': no photo yet'}>
      <PawMark className="photo-fallback-mark" />
      <span className="photo-fallback-text">Photo coming soon</span>
    </span>
  )
}

// The pet name is the card's link; its overlay makes the whole card tappable
// while the action buttons stay above it and keep their own targets.
export function ListingCard({ row, href, actions }: { row: PublicListing; href: string; actions?: ReactNode }) {
  return (
    <article className="pet-card">
      <div className="pet-photo">
        <Photo url={row.photo_url} name={row.name} />
      </div>
      <div className="pet-body">
        <h3><NavLink className="pet-card-link" to={href} aria-label={'View record for ' + row.name}>{row.name}</NavLink></h3>
        <div className="pet-meta">{speciesLabel(row.species)} · {ageLabel(row.birth_date)} · {sexLabel(row.sex)}</div>
        <div className="pet-tags"><PetCode code={row.qr_slug} compact />{originBadge(row.custody_source)}</div>
        {actions ? <div className="btn-row pet-card-actions">{actions}</div> : <span className="pet-card-cue" aria-hidden="true">View record →</span>}
      </div>
    </article>
  )
}

export function CardSkeletons({ count = 6, label = 'Loading pets…' }: { count?: number; label?: string }) {
  return (
    <div className="pet-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="pet-card skeleton-card" aria-hidden="true">
          <div className="pet-photo skeleton-block" />
          <div className="pet-body">
            <span className="skeleton-line skeleton-title" />
            <span className="skeleton-line" />
            <span className="skeleton-line skeleton-short" />
          </div>
        </div>
      ))}
    </div>
  )
}

const TRACK_STEPS = ['Submitted', 'CAVD review', 'Interview & requirements', 'Decision'] as const

// Applicants see where an application sits in CAVD's review. The stage still
// comes from the database; this only arranges it as steps.
export function ApplicationTracker({ stage, status, compact = false }: {
  stage: string | null | undefined; status: string; compact?: boolean
}) {
  const decided = status === 'approved' || status === 'rejected' || stage === 'approved' || stage === 'rejected'
  const approved = status === 'approved' || stage === 'approved'
  const current = decided ? 3 : stage === 'for_interview' || stage === 'additional_requirements' ? 2 : 1
  const labels = TRACK_STEPS.map((step, i) => i === 3 && decided ? (approved ? 'Approved' : 'Not approved') : step)
  if (compact) {
    return <span className="tracker-compact" aria-label={`Step ${current + 1} of 4: ${labels[current]}`}>
      {labels.map((label, i) => <span key={label} className={'tracker-dot' + (decided && i === 3 && !approved ? ' declined'
        : i < current || (decided && i === 3) ? ' done' : i === current ? ' current' : '')} title={label} />)}
    </span>
  }
  return (
    <ol className="tracker" aria-label="Application progress">
      {labels.map((label, i) => {
        // Every decision follows CAVD review, but a decline can come before an
        // interview, so that step is not claimed as done.
        const state = decided
          ? i === 3 ? (approved ? 'done' : 'declined') : approved || i < 2 ? 'done' : 'skipped'
          : i < current ? 'done' : i === current ? 'current' : 'upcoming'
        return (
          <li key={label} className={'tracker-step tracker-' + state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="tracker-marker" aria-hidden="true">{state === 'done' ? '✓' : state === 'declined' ? '×' : i + 1}</span>
            <span className="tracker-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function SaveListingButton({ saved, busy, disabled, onToggle }: {
  saved: boolean; busy?: boolean; disabled?: boolean; onToggle: () => void
}) {
  return <button className="btn btn-sm btn-outline" type="button" aria-pressed={saved}
    disabled={disabled || busy} onClick={onToggle}>{busy ? 'Saving…' : saved ? 'Saved ♥' : 'Save pet ♡'}</button>
}

export function PetCode({ code, compact = false }: { code: string; compact?: boolean }) {
  return <span className={'pet-code' + (compact ? ' pet-code-compact' : '')}>
    <span className="pet-code-label">PET ID</span>
    <strong className="pet-code-value">{code.toUpperCase()}</strong>
  </span>
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

function WorkspaceNavIcon({ to }: { to: string }) {
  const icon = to.endsWith('/registrations') || to.endsWith('/applications') ? <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 9h6m-6 4h6m-6 4h3M9 4V2h6v2" /></>
    : to.endsWith('/listings') ? <path d="M12 20s-8-4.7-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.3-8 10-8 10Z" />
      : to.endsWith('/adoption-rules') ? <><path d="M12 3 4.5 6v6c0 4.5 7.5 9 7.5 9s7.5-4.5 7.5-9V6L12 3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>
        : to.endsWith('/accounts') ? <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5" /></>
          : to.endsWith('/verifications') ? <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="10" r="2" /><path d="M5 16a3 3 0 0 1 6 0m3-6h4m-4 4h4" /></>
            : to.endsWith('/intake') ? <><path d="m3 10 9-7 9 7v10H3V10Z" /><path d="M9 15h6m-3-3v6" /></>
              : to.endsWith('/registry') ? <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8m-8 4h8m-8 4h5" /></>
                : to.endsWith('/veterinary') ? <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8m-4-4h8" /></>
                  : <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
}

export function DashboardWelcome({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return <section className="dashboard-welcome">
    <div><h1>{title}</h1><p className="sub">{children}</p><div className="btn-row">{actions}</div></div>
    <img className="dashboard-welcome-photo" src={assetUrl('/home-hero-shelter.webp')} alt="A person petting a happy aspin" width="180" height="180" />
  </section>
}
export type TabItem = { to: string; label: string; end?: boolean; icon: keyof typeof TAB_ICONS }

const TAB_ICONS = {
  home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1Z" />,
  pets: <><circle cx="7" cy="9" r="1.8" /><circle cx="12" cy="6.5" r="1.8" /><circle cx="17" cy="9" r="1.8" /><path d="M12 12c-3 0-5.5 3.2-5.5 5.4 0 1.7 1.4 2.6 3 2.1l1.4-.4a3.6 3.6 0 0 1 2.2 0l1.4.4c1.6.5 3-.4 3-2.1C17.5 15.2 15 12 12 12Z" /></>,
  adopt: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  apps: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  profile: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>
}

// Bottom navigation replaces the header section list on phone-sized user pages.
function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <nav className="tabbar" aria-label="Quick navigation">
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => isActive ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TAB_ICONS[t.icon]}</svg>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function CivicFrame({ children, nav = [], menuItems, serviceName = 'Pet registry & adoption', action, variant = 'public', tabs, workspaceIdentity }: {
  children: ReactNode
  nav?: NavItem[]
  menuItems?: NavItem[]
  serviceName?: string
  action?: ReactNode
  variant?: string
  tabs?: TabItem[]
  workspaceIdentity?: { who: string; roleLabel: string; extra?: ReactNode }
}) {
  const workspace = variant === 'office'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('pawslink-theme', next) } catch { /* Theme still works for this visit. */ }
    setTheme(next)
  }

  return (
    <div className={'site site-' + variant + (tabs?.length ? ' has-tabbar' : '') + (workspace ? ' is-workspace' : '')}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {workspace ? <aside className="workspace-sidebar" aria-label={`${serviceName} workspace`}>
        <NavLink to="/" className="brand" aria-label="PawsLink home">
          <span className="brand-mark"><PawMark /></span><span className="brand-copy"><span className="wordmark">PawsLink</span><span className="brand-subtitle">{serviceName}</span></span>
        </NavLink>
        <nav className="workspace-nav" aria-label="Workspace navigation">{nav.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
          <WorkspaceNavIcon to={item.to} /><span>{item.label}</span>{item.count ? <span className="count">{item.count}</span> : null}
        </NavLink>)}</nav>
        {workspaceIdentity ? <div className="workspace-identity"><span className="workspace-avatar" aria-hidden="true">{workspaceIdentity.who.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span>
          <div><strong>{workspaceIdentity.who}</strong><span>{workspaceIdentity.roleLabel}</span></div>
          {workspaceIdentity.extra ? <div className="workspace-description">{workspaceIdentity.extra}</div> : null}
        </div> : null}
      </aside> : null}
      <div className="site-header">
        <header className="topbar">
          <div className="chrome-inner">
            <NavLink to="/" className="brand" aria-label="PawsLink home">
              <span className="brand-mark"><PawMark /></span>
              <span className="brand-copy"><span className="wordmark">PawsLink</span><span className="brand-subtitle">A caring home starts here</span></span>
            </NavLink>
            {workspace ? <span className="workspace-context">{serviceName}</span> : null}
            <div className="topbar-actions">
              <span className="city-name">Butuan City · CAVD</span>
              <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
                {theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/></svg>}
                <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
              {action}
              {menuItems ? <details className="public-menu">
                <summary aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary>
                <nav className="public-menu-list" aria-label="Menu" onClick={event => { (event.currentTarget.parentElement as HTMLDetailsElement).open = false }}>
                  {menuItems.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => isActive ? 'active' : ''}>{n.label}</NavLink>)}
                </nav>
              </details> : null}
            </div>
          </div>
        </header>
        <div className={'servicebar' + (nav.length > 3 ? ' has-mobile-menu' : '') + (menuItems ? ' has-burger' : '')}>
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
      </div>
      <main id="main-content" className="layout" tabIndex={-1}>{children}</main>
      <footer className="footer-note"><div className="chrome-inner">
        <p>PawsLink · Butuan City pet registry and adoption</p><p>© {new Date().getFullYear()} City of Butuan · CAVD</p>
      </div></footer>
      {tabs?.length ? <TabBar tabs={tabs} /> : null}
    </div>
  )
}

export function Shell({
  who, roleLabel, nav, children, onSignOut, extra, showIdentity = true, tabs
}: {
  who: string
  roleLabel: string
  nav: NavItem[]
  children: ReactNode
  onSignOut: () => void
  extra?: ReactNode
  showIdentity?: boolean
  tabs?: TabItem[]
}) {
  const office = nav.some(item => item.to === '/office')
  return (
    <CivicFrame
      variant={office ? 'office' : 'user'}
      serviceName={office ? 'CAVD office' : 'My registry'}
      nav={nav}
      tabs={tabs}
      workspaceIdentity={{ who, roleLabel, extra }}
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
