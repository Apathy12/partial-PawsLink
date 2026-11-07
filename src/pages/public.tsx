import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { explain, supabase, supabaseConfigured } from '../lib/supabase'
import { ageLabel, assetUrl, fmtDate, sexLabel, sizeLabel, speciesLabel } from '../lib/format'
import { accountDestination } from '../lib/onboarding'
import { TurnstileChallenge } from '../lib/turnstile'
import { turnstileSiteKey } from '../lib/turnstile-config'
import type { PublicPet } from '../lib/types'
import { CivicFrame, Field, Notice, PetCode, Photo, Pill, originBadge } from '../ui'
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
    { to: '/explore', label: 'Explore pets' },
    ...(session && profile ? [{ to: accountPath, label: accountPath === '/verify' ? 'ID review' : 'My account' }] : [])
  ]
  const menuItems = session && profile ? nav : [...nav, { to: '/register', label: 'Create account' }]
  return <CivicFrame variant="public" nav={nav} menuItems={menuItems} serviceName="Explore PawsLink" action={
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
          <h1>Find the pet that fits your home</h1>
          <p>Every pet listed is vet-cleared and reviewed by CAVD in Butuan City.</p>
          <div className="btn-row">
            <Link className="btn" to="/app/match">Find My Match <span aria-hidden="true">→</span></Link>
            <Link className="home-hero-link" to="/explore">Browse pets</Link>
          </div>
        </div>
        <div className="home-hero-photo"><img src={assetUrl('/home-hero-shelter.webp')} alt="A person gently petting a happy aspin" width="1122" height="1402" fetchPriority="high" /></div>
      </div>
      <section id="awareness" className="public-awareness" aria-labelledby="public-awareness-title">
        <div className="page-head"><span className="step-label">Digital education</span><h2 id="public-awareness-title">Learn to care. Share what helps.</h2><p className="sub">Explore practical pet care, safer interactions, and rabies awareness before you join PawsLink.</p></div>
        <EducationHome publicView />
      </section>
    </PublicFrame>
  )
}

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
        <p className="sub">Use your PawsLink account to access your pets or your CAVD workspace.</p>
        {err ? <Notice kind="bad">{err}</Notice> : null}
        <form onSubmit={onSubmit}>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
          <TurnstileChallenge onToken={setCaptchaToken} resetKey={captchaReset} />
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="sub" style={{ marginTop: '1rem' }}>Need an owner/adopter account? <Link to="/register">Register</Link>.</p>
      </div>
    </PublicFrame>
  )
}

/** Bump when the wording of the data privacy notice changes. */
const PRIVACY_NOTICE_VERSION = '2026-11'

export function RegisterPage() {
  const { signUp, session, profile, verification, configured } = useAuth()
  const nav = useNavigate()
  const [privacyAgreed, setPrivacyAgreed] = useState(false)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  if (!configured) return <Navigate to="/setup" replace />
  if (!busy && session && profile) return <Navigate to={accountDestination(profile, session.user, verification)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    if (!privacyAgreed) { setErr('Read the data privacy notice and tick the box to continue.'); setBusy(false); return }
    if (turnstileSiteKey && !captchaToken) { setErr('Complete the security check first.'); setBusy(false); return }
    try {
      const result = await signUp(email.trim(), password, name.trim(), contact.trim(), PRIVACY_NOTICE_VERSION, captchaToken || undefined)
      if (result.error) { setErr(result.error); return }
      if (result.needsConfirmation) {
        nav('/check-email', { replace: true, state: { email: email.trim() } })
        return
      }
      nav('/app/profile', { replace: true })
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
        <div className="step-label">Step 1 of 4 · Your account</div>
        <h1>Join PawsLink</h1>
        <p className="sub">Create your account, confirm your email, and make your profile yours. Upload a valid government ID to enter your owner/adopter space right away.</p>
        {err ? <Notice kind="bad">{err}</Notice> : null}
        <form onSubmit={onSubmit}>
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} required /></Field>
          <Field label="Contact number"><input value={contact} onChange={e => setContact(e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label="Password" hint="At least 8 characters.">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </Field>
          <section className="privacy-notice" aria-labelledby="privacy-notice-title">
            <h2 id="privacy-notice-title">Data privacy notice</h2>
            <p>PawsLink collects your name, contact number and email address, the government ID you upload for verification, and the pet and adoption records you submit. The City Agriculture and Veterinary Department (CAVD) uses this information only to verify your account, process pet registrations and adoption applications, and contact you about them.</p>
            <p>Uploaded IDs are visible only to authorized CAVD reviewers and are never shown on public pet profiles. Your information is processed in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173). You may ask CAVD to access or correct your personal information.</p>
          </section>
          <label className="check-row consent-row">
            <input type="checkbox" checked={privacyAgreed} onChange={e => setPrivacyAgreed(e.target.checked)} required />
            <span>I have read the data privacy notice and agree to the collection and processing of my personal information for these purposes.</span>
          </label>
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
          <li>Return to customize your profile, then upload your valid ID to enter PawsLink. Log in if asked.</li>
        </ol>
        <p className="sub">If the link confirms your email but the page does not open, return here and sign in with the email and password you registered.</p>
        <div className="btn-row"><a className="btn" href="https://mail.google.com/" target="_blank" rel="noreferrer">Open Gmail</a><Link className="btn btn-outline" to="/login">I confirmed my email</Link></div>
      </div>
    </PublicFrame>
  )
}

export function PublicPetPage() {
  const { slug } = useParams()
  const { profile, loading } = useAuth()
  const [pet, setPet] = useState<PublicPet | null | undefined>(undefined)
  const [mine, setMine] = useState<{ slug: string; owned: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    supabase.from('public_pets').select('*').eq('qr_slug', slug).maybeSingle()
      .then(({ data, error }) => {
        if (error) setErr(explain(error))
        setPet((data as PublicPet) ?? null)
      })
  }, [slug])

  // The public view has no owner or pet id, so ask for the person's own row.
  useEffect(() => {
    if (!slug || !profile) return
    supabase.from('pets').select('id').eq('owner_id', profile.id).eq('qr_slug', slug).maybeSingle()
      .then(({ data, error }) => { if (!error) setMine({ slug, owned: Boolean(data) }) })
  }, [slug, profile])
  const ownership = !loading && !profile ? 'other' : mine && mine.slug === slug ? (mine.owned ? 'mine' : 'other') : 'unknown'

  return (
    <PublicFrame>
      <div className="page-head">
        <h1>{pet ? pet.name : 'Public pet record'}</h1>
        <p className="sub">CAVD pet registry · Butuan City</p>
        {pet ? <PetCode code={pet.qr_slug} /> : null}
        {pet ? <ul className="fact-chips" aria-label="Key facts">
          <li>{speciesLabel(pet.species)} · {sexLabel(pet.sex)} · {ageLabel(pet.birth_date)}</li>
          <li className={pet.rabies_vaccinated ? 'fact-ok' : ''}>{pet.rabies_vaccinated ? '✓ Rabies vaccinated' : 'Rabies not marked'}</li>
          <li className={pet.sterilized ? 'fact-ok' : ''}>{pet.sterilized ? '✓ Sterilised' : 'Not sterilised'}</li>
          <li className="fact-badge">{originBadge(pet.custody_source)}</li>
          {pet.is_listed ? <li className="fact-highlight">Available for adoption</li> : null}
        </ul> : null}
      </div>
      {err ? <Notice kind="bad">{err}</Notice> : null}
      {pet === undefined ? <p className="sub" role="status">Loading pet record…</p> : null}
      {pet === null ? <Notice kind="bad">This pet record is not available.</Notice> : null}
      {pet ? (
        <div className="split">
          <div className="record-main">
              <div className="record-photo pet-photo"><Photo url={pet.photo_url} name={pet.name} /></div>
              <Notice kind="ok"><b>Verified CAVD registry record</b></Notice>
              <dl className="kv">
                <dt>Species</dt><dd>{speciesLabel(pet.species)}</dd>
                <dt>Breed</dt><dd>{pet.breed || '—'}</dd>
                <dt>Sex</dt><dd>{sexLabel(pet.sex)}</dd>
                <dt>Age</dt><dd>{ageLabel(pet.birth_date)}</dd>
                <dt>Size</dt><dd>{sizeLabel(pet.size)}</dd>
                <dt>Sterilised</dt><dd>{pet.sterilized ? 'Yes' : 'No'}</dd>
                <dt>Rabies</dt><dd>{pet.rabies_vaccinated ? `Vaccinated${pet.rabies_vaccinated_on ? ' ' + fmtDate(pet.rabies_vaccinated_on) : ''}` : 'Not marked by CAVD'}</dd>
                <dt>Listing status</dt><dd>{pet.is_listed ? 'Listing approved' : 'Not listed for adoption'}</dd>
              </dl>
          </div>
          <aside className="record-aside">
            {pet.is_listed && pet.listing_id ? <>
              <h2>{ownership === 'mine' ? 'Your pet' : `Interested in ${pet.name}?`}</h2>
              {ownership === 'mine' ? <Pill kind="owner">Your pet</Pill> : <>
                <p>{pet.name} is listed for adoption. Sign in to see adoption options, or use Find My Pet Match to compare pets that suit your home.</p>
                {ownership === 'other' ? <div className="btn-row">
                  <Link className="btn" to={`/app/listings/${pet.listing_id}`}>Adoption options</Link>
                  <Link className="btn btn-outline" to="/app/match">Find My Pet Match</Link>
                </div> : null}
              </>}
            </> : <>
              <h2>Adoption</h2>
              <p>This pet is registered with CAVD and is not currently listed for adoption.</p>
            </>}
            <div className="card">
              <p className="sub">Owner contact and clinical notes are private. CAVD handles adoption and ownership transfers.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </PublicFrame>
  )
}
