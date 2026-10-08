import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { explain, supabase, supabaseConfigured } from '../lib/supabase'
import { ageLabel, assetUrl, fmtDate, qrUrl, sexLabel, sizeLabel, sourceLabel, speciesLabel } from '../lib/format'
import { accountDestination } from '../lib/onboarding'
import { TurnstileChallenge } from '../lib/turnstile'
import { turnstileSiteKey } from '../lib/turnstile-config'
import type { PublicPet } from '../lib/types'
import { CivicFrame, Field, Notice, Photo, QrBlock, Scanner } from '../ui'
import { EducationHome } from './education'

export function SetupPage() {
  if (supabaseConfigured) return <Navigate to="/" replace />
  return (
    <PublicFrame>
      <div className="auth-card card">
        <h1>Connect Supabase</h1>
        <p className="sub">Copy <span className="mono">.env.example</span> to <span className="mono">.env.local</span>, paste the project URL and anon key, then restart <span className="mono">npm run dev</span>.</p>
        <p className="sub">Run the SQL in <span className="mono">supabase/migrations</span> on that project, then <span className="mono">npm run seed</span>.</p>
      </div>
    </PublicFrame>
  )
}

export function PublicFrame({ children }: { children: ReactNode }) {
  const { profile, session, verification } = useAuth()
  const accountPath = profile && session ? accountDestination(profile, session.user, verification) : '/login'
  const nav = [
    { to: '/', label: 'Home', end: true },
    ...(session && profile ? [{ to: accountPath, label: accountPath === '/verify' ? 'ID review' : 'My account' }] : []),
    { to: '/scan', label: 'Scan a tag' }
  ]
  return <CivicFrame variant="public" nav={nav} serviceName="Explore PawsLink" action={
    session && profile ? <Link className="header-action" to={accountPath}>
      {accountPath === '/verify' ? 'Finish signup' : 'My space'} <span aria-hidden="true">↗</span>
    </Link> : <div className="account-actions">
      <Link className="header-action header-action-outline" to="/register">Create account</Link>
      <Link className="header-action" to="/login">Log in</Link>
    </div>
  }>{children}</CivicFrame>
}

export function LandingPage() {
  return (
    <PublicFrame>
      <div className="home-intro">
        <div className="home-hero-copy">
          <div className="office-name">Butuan City · Pet care and adoption</div>
          <h1>Good care. Safe records. Happier homes.</h1>
          <p>Learn how to care for pets, keep your companion’s records, and help animals in your community.</p>
          <div className="btn-row">
            <a className="btn" href="#awareness">Explore pet care <span aria-hidden="true">→</span></a>
            <Link className="btn btn-outline" to="/register">Register your pet</Link>
          </div>
        </div>
        <div className="home-hero-photo"><img src={assetUrl('/home-hero-pets.webp')} alt="Two cats and two dogs playing together in a garden" width="1122" height="1402" fetchPriority="high" /></div>
      </div>
      <section id="awareness" className="public-awareness" aria-labelledby="public-awareness-title">
        <div className="page-head"><span className="step-label">Digital education and community awareness</span><h2 id="public-awareness-title">Learn to care. Share what helps.</h2><p className="sub">Explore practical pet care, safer interactions, and rabies awareness before you join PawsLink.</p></div>
        <EducationHome publicView />
      </section>
      <section className="home-next-steps" aria-labelledby="home-next-steps-title">
        <div className="page-head"><span className="step-label">Your next step</span><h2 id="home-next-steps-title">How can we help?</h2></div>
        <div className="home-quicklinks" aria-label="Quick paths">
          <Link to="/register" className="quicklink"><span className="quicklink-icon" aria-hidden="true">＋</span><span><strong>Pet owner?</strong><small>Create your account and register your pet.</small></span><span aria-hidden="true">→</span></Link>
          <Link to="/scan" className="quicklink"><span className="quicklink-icon" aria-hidden="true">⌗</span><span><strong>Found a pet?</strong><small>Scan its tag to view its public record.</small></span><span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </PublicFrame>
  )
}

const DEMO = [
  ['user@demo.local', 'Owner (Ana Reyes)'],
  ['adopter@demo.local', 'Adopter (Ben Santos)'],
  ['vet@demo.local', 'Veterinarian'],
  ['cavd@demo.local', 'CAVD office']
]

export function LoginPage() {
  const { signIn, profile, verification, session, loading, configured } = useAuth()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  if (!configured) return <Navigate to="/setup" replace />
  if (!loading && session && profile) {
    const dest = (loc.state as { from?: string } | null)?.from
    const next = accountDestination(profile, session.user, verification)
    return <Navigate to={next === '/app/profile' || next === '/verify' ? next : dest || next} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      if (turnstileSiteKey && !captchaToken) { setErr('Complete the security check first.'); return }
      const msg = await signIn(email.trim(), password, captchaToken || undefined)
      if (msg) setErr(msg)
    } catch (cause) {
      setErr(explain(cause as { message?: string }))
    } finally {
      setBusy(false)
      setCaptchaToken(null)
      setCaptchaReset(current => current + 1)
    }
  }

  return (
    <PublicFrame>
      <div className="auth-card card">
        <h1>Log in</h1>
        <p className="sub">Use your PawsLink account to access your pets, clinic, or CAVD workspace.{import.meta.env.DEV ? ' Demo accounts are listed below.' : ''}</p>
        {err ? <Notice kind="bad">{err}</Notice> : null}
        <form onSubmit={onSubmit}>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
          <TurnstileChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="sub" style={{ marginTop: '1rem' }}>Need an owner/adopter account? <Link to="/register">Register</Link>.</p>
        {import.meta.env.DEV ? <div className="demo-box">
          <p>Demo accounts work only after <code>npm run seed</code> has been run for this Supabase project.</p>
          <p>Use the private demo credentials in your local <code>.env.local</code> file.</p>
          <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem' }}>
            {DEMO.map(([e, l]) => <li key={e}><code>{e}</code> — {l}</li>)}
          </ul>
        </div> : null}
      </div>
    </PublicFrame>
  )
}

export function RegisterPage() {
  const { signUp, session, profile, verification, configured } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [requestedRole, setRequestedRole] = useState<'user' | 'vet'>('user')
  const [clinicName, setClinicName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  if (!configured) return <Navigate to="/setup" replace />
  if (!busy && session && profile) return <Navigate to={accountDestination(profile, session.user, verification)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    if (turnstileSiteKey && !captchaToken) { setErr('Complete the security check first.'); setBusy(false); return }
    try {
      const result = await signUp(email.trim(), password, name.trim(), contact.trim(), requestedRole, clinicName.trim(), captchaToken || undefined)
      if (result.error) { setErr(result.error); return }
      if (result.needsConfirmation) {
        nav('/check-email', { replace: true, state: { email: email.trim(), requestedRole } })
        return
      }
      nav(requestedRole === 'user' ? '/app/profile' : '/verify', { replace: true })
    } catch (cause) {
      setErr(explain(cause as { message?: string }))
    } finally {
      setBusy(false)
      setCaptchaToken(null)
      setCaptchaReset(current => current + 1)
    }
  }

  return (
    <PublicFrame>
      <div className="auth-card card">
        <div className="step-label">Step 1 of {requestedRole === 'user' ? '4' : '3'} · Your account</div>
        <h1>Join PawsLink</h1>
        <p className="sub">{requestedRole === 'user'
          ? 'Create your account, confirm your email, and make your profile yours. Upload a valid government ID to enter your owner/adopter space right away.'
          : 'Create your account, confirm your email, then submit your PRC ID for CAVD review. Veterinary access starts after approval.'}</p>
        {err ? <Notice kind="bad">{err}</Notice> : null}
        <form onSubmit={onSubmit}>
          <Field label="I am registering as">
            <select value={requestedRole} onChange={e => setRequestedRole(e.target.value as 'user' | 'vet')}>
              <option value="user">Pet owner or adopter</option>
              <option value="vet">Veterinarian / clinic</option>
            </select>
          </Field>
          {requestedRole === 'vet' ? <Field label="Clinic name"><input value={clinicName} onChange={e => setClinicName(e.target.value)} required /></Field> : null}
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} required /></Field>
          <Field label="Contact number"><input value={contact} onChange={e => setContact(e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label="Password" hint="At least 8 characters.">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </Field>
          <TurnstileChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="sub" style={{ marginTop: '1rem' }}>Already registered? <Link to="/login">Sign in</Link>.</p>
      </div>
    </PublicFrame>
  )
}

export function CheckEmailPage() {
  const loc = useLocation()
  const email = (loc.state as { email?: string } | null)?.email
  const isVet = (loc.state as { requestedRole?: string } | null)?.requestedRole === 'vet'
  return (
    <PublicFrame>
      <div className="feedback-card">
        <div className="feedback-icon" aria-hidden="true">✉</div>
        <div className="step-label">Confirm your email</div>
        <h1>Check your inbox</h1>
        <Notice kind="ok">Registration submitted. Confirm your email to continue setting up your account.</Notice>
        <p>We sent a confirmation link{email ? <> to <strong>{email}</strong></> : null}. Open it to activate your PawsLink account.</p>
        <ol className="feedback-steps">
          <li>Open your email or Gmail inbox. Check Spam if you do not see the message.</li>
          <li>Tap the confirmation link in the email.</li>
          <li>{isVet ? 'Return to submit your PRC ID for CAVD review. Log in if asked.' : 'Return to customize your profile, then upload your valid ID to enter PawsLink. Log in if asked.'}</li>
        </ol>
        <p className="sub">If the link confirms your email but the page does not open, return here and sign in with the email and password you registered.</p>
        <div className="btn-row"><a className="btn" href="https://mail.google.com/" target="_blank" rel="noreferrer">Open Gmail</a><Link className="btn btn-outline" to="/login">I confirmed my email</Link></div>
      </div>
    </PublicFrame>
  )
}

export function PublicPetPage() {
  const { slug } = useParams()
  const [pet, setPet] = useState<PublicPet | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    supabase.from('public_pets').select('*').eq('qr_slug', slug).maybeSingle()
      .then(({ data, error }) => {
        if (error) setErr(explain(error))
        setPet((data as PublicPet) ?? null)
      })
  }, [slug])

  return (
    <PublicFrame>
      <div className="page-head">
        <h1>{pet ? pet.name : 'Public pet record'}</h1>
        <p className="sub">CAVD pet registry · Butuan City</p>
      </div>
      {err ? <Notice kind="bad">{err}</Notice> : null}
      {pet === undefined ? <p className="sub">Loading…</p> : null}
      {pet === null ? <Notice kind="bad">No approved registry record matches this tag.</Notice> : null}
      {pet ? (
        <div className="split">
          <div className="record-main">
              <div className="record-photo pet-photo"><Photo url={pet.photo_url} name={pet.name} /></div>
              <div className="pet-id">Registry tag: {pet.qr_slug}</div>
              <Notice kind="ok"><b>Verified CAVD registry record</b></Notice>
              <dl className="kv">
                <dt>Species</dt><dd>{speciesLabel(pet.species)}</dd>
                <dt>Breed</dt><dd>{pet.breed || '—'}</dd>
                <dt>Sex</dt><dd>{sexLabel(pet.sex)}</dd>
                <dt>Age</dt><dd>{ageLabel(pet.birth_date)}</dd>
                <dt>Size</dt><dd>{sizeLabel(pet.size)}</dd>
                <dt>Custody</dt><dd>{sourceLabel(pet.source)}</dd>
                <dt>Sterilised</dt><dd>{pet.sterilized ? 'Yes' : 'No'}</dd>
                <dt>Rabies</dt><dd>{pet.rabies_vaccinated ? `Vaccinated${pet.rabies_vaccinated_on ? ' ' + fmtDate(pet.rabies_vaccinated_on) : ''}` : 'Not marked by CAVD'}</dd>
                <dt>Listing status</dt><dd>{pet.is_listed ? 'Listing approved' : 'Not listed for adoption'}</dd>
              </dl>
              <p className="sub">Found this animal? Contact CAVD and quote the tag above. The city will reach the registered owner.</p>
          </div>
          <aside className="record-aside">
            <h2>Find My Pet Match</h2>
            {pet.is_listed && pet.listing_id ? <>
              <p>{pet.name} is listed for adoption. Sign in and use Find My Pet Match to see ranked pets and start an application from a match.</p>
              <Link className="btn" to="/app/match">Find My Pet Match</Link>
            </> : <p>This pet is registered with CAVD and is not currently listed for adoption.</p>}
            <div className="card">
              <h2>Registry QR</h2>
              <QrBlock value={qrUrl(pet.qr_slug)} />
            </div>
            <div className="card">
              <p className="sub">Owner contact and clinical notes are private. CAVD handles adoption and ownership transfers.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </PublicFrame>
  )
}

export function ScanPage() {
  const nav = useNavigate()
  return (
    <PublicFrame>
      <div className="page-head">
        <h1>Scan a PawsLink QR</h1>
        <p className="sub">Use the phone camera. The code opens one public profile. Nothing about the scan is stored.</p>
      </div>
      <div className="card" style={{ maxWidth: '28rem' }}>
        <Scanner onSlug={(slug) => nav('/p/' + slug)} />
      </div>
    </PublicFrame>
  )
}
