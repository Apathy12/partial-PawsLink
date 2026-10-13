import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { appUrl } from '../lib/format'
import { hasCavdMfa, requiresCavdMfa } from '../lib/mfa'
import { explain, supabase } from '../lib/supabase'
import { Field, Notice } from '../ui'
import { PublicFrame } from './public'

type Enrollment = { id: string; qr: string; secret: string }

export function OfficeMfaPage() {
  const { session, signOut } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (!active) return
      if (listError) setError(explain(listError))
      else setFactorId(data.totp[0]?.id || null)
      setLoading(false)
    }).catch(cause => {
      if (active) { setError(explain(cause as { message?: string })); setLoading(false) }
    })
    return () => { active = false }
  }, [])

  if (!requiresCavdMfa(session) || hasCavdMfa(session)) return <Navigate to="/office" replace />

  async function startEnrollment() {
    setBusy(true); setError(null)
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      for (const factor of factors.all) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
          if (removeError) throw removeError
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PawsLink CAVD' })
      if (enrollError) throw enrollError
      setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (cause) {
      setError(explain(cause as { message?: string }))
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    const id = factorId || enrollment?.id
    if (!id || !/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code from your authenticator app.')
      return
    }
    setBusy(true); setError(null)
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() })
      if (verifyError) throw verifyError
      setEnrollment(null)
      setCode('')
      window.location.replace(appUrl('/office'))
    } catch (cause) {
      setError(explain(cause as { message?: string }))
    } finally {
      setBusy(false)
    }
  }

  return <PublicFrame>
    <div className="auth-card card">
      <div className="step-label">CAVD account security</div>
      <h1>Verify your sign-in</h1>
      <p className="sub">CAVD records and decisions require a code from an authenticator app on each new sign-in.</p>
      {error ? <Notice kind="bad">{error}</Notice> : null}
      {loading ? <p className="sub">Checking your security setup…</p> : factorId ?
        <form onSubmit={verify}>
          <Field label="Authenticator code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required /></Field>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and open CAVD'}</button>
        </form> : <>
          {!enrollment ? <button className="btn" type="button" disabled={busy} onClick={() => void startEnrollment()}>{busy ? 'Preparing…' : 'Set up authenticator'}</button> : <>
            <p>Scan this code with an authenticator app, then enter its six-digit code.</p>
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}`} alt="Authenticator setup QR code" width="200" height="200" />
            <p className="hint">If you cannot scan it, enter this setup key in your app: <code>{enrollment.secret}</code></p>
            <form onSubmit={verify}>
              <Field label="Authenticator code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required /></Field>
              <button className="btn" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Finish setup'}</button>
            </form>
          </>}
        </>}
      <p className="sub" style={{ marginTop: '1rem' }}><button type="button" className="btn btn-outline" onClick={() => void signOut()}>Sign out</button></p>
    </div>
  </PublicFrame>
}
