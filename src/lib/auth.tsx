import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { explain, supabase, supabaseConfigured } from './supabase'
import { appUrl, homeFor } from './format'
import { needsProfileSetup } from './onboarding'
import { hasCavdMfa, requiresCavdMfa } from './mfa'
import type { Profile, Role, VerificationRequest } from './types'

type AuthValue = {
  session: Session | null
  profile: Profile | null
  verification: VerificationRequest | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<string | null>
  signUp: (email: string, password: string, name: string, contact: string, requestedRole: 'user' | 'vet', clinicName: string, captchaToken?: string) => Promise<{ error: string | null; needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [verification, setVerification] = useState<VerificationRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const loadNumber = useRef(0)

  async function loadProfile(s: Session | null) {
    const number = ++loadNumber.current
    if (!s) {
      setProfile(null)
      setVerification(null)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    if (number !== loadNumber.current) return
    if (error) {
      console.warn(error.message)
      setProfile(null)
      setVerification(null)
      return
    }
    const nextProfile = data as Profile | null
    if (nextProfile && nextProfile.verification_exempt === false) {
      const { data: request, error: requestError } = await supabase.from('verification_requests')
        .select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (number !== loadNumber.current) return
      if (requestError) console.warn(requestError.message)
      setVerification((request as VerificationRequest) || null)
    } else {
      setVerification(null)
    }
    setProfile(nextProfile)
  }

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      return loadProfile(data.session)
    }).finally(() => { if (alive) setLoading(false) })

    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      setSession(next)
      setLoading(true)
      void loadProfile(next).finally(() => { if (alive) setLoading(false) })
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthValue>(() => ({
    session,
    profile,
    verification,
    loading,
    configured: supabaseConfigured,
    async signIn(email, password, captchaToken) {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password,
          options: captchaToken ? { captchaToken } : undefined })
        return error ? explain(error) : null
      } catch (cause) {
        return explain(cause as { message?: string })
      }
    },
    async signUp(email, password, name, contact, requestedRole, clinicName, captchaToken) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: appUrl('/verify'),
          ...(captchaToken ? { captchaToken } : {}),
          data: {
            name, contact, requested_role: requestedRole, clinic_name: clinicName,
            ...(requestedRole === 'user' ? { profile_setup_complete: false } : {})
          }
        }
      })
      return { error: error ? explain(error) : null, needsConfirmation: !error && !data.session }
    },
    async signOut() {
      await supabase.auth.signOut()
      setProfile(null)
      setVerification(null)
    },
    async refresh() {
      await loadProfile(session)
    }
  }), [session, profile, verification, loading])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside provider')
  return v
}

export function RequireAuth({ children, roles, allowUnverified = false, allowMfaSetup = false }: { children: ReactNode; roles?: Role[]; allowUnverified?: boolean; allowMfaSetup?: boolean }) {
  const { session, profile, verification, loading, configured } = useAuth()
  const loc = useLocation()

  if (!configured) return <Navigate to="/setup" replace />
  if (loading) return <p className="sub" style={{ padding: '2rem' }}>Loading…</p>
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!profile) return <p className="sub" style={{ padding: '2rem' }}>No profile found for this account.</p>
  if (!profile.is_active) {
    return (
      <div className="card" style={{ margin: '2rem auto', maxWidth: '28rem' }}>
        <h1>Account disabled</h1>
        <p className="sub">CAVD has disabled this account. Sign in with a different email or contact the registry desk.</p>
      </div>
    )
  }
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to={homeFor(profile.role)} replace />
  }
  if (profile.role === 'cavd' && !allowMfaSetup && requiresCavdMfa(session) && !hasCavdMfa(session)) {
    return <Navigate to="/office/mfa" replace />
  }
  if (needsProfileSetup(profile, session.user) && loc.pathname !== '/app/profile') {
    return <Navigate to="/app/profile" replace />
  }
  if (!allowUnverified && profile.verification_exempt === false && verification?.status !== 'approved') {
    return <Navigate to="/verify" replace />
  }
  return children
}
