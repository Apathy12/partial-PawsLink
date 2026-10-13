import type { Session } from '@supabase/supabase-js'

// The temporary demo exception applies only to the named demo account.
const demoPasswordOnly = import.meta.env.VITE_CAVD_DEMO_PASSWORD_ONLY === 'true'

export function requiresCavdMfa(session: Session | null) {
  return !(demoPasswordOnly && session?.user.email?.toLowerCase() === 'cavd@demo.local')
}

// This is only a route hint. SQL policies enforce aal2 for other CAVD accounts.
export function hasCavdMfa(session: Session | null) {
  if (!session?.access_token) return false
  try {
    const encoded = session.access_token.split('.')[1]
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { aal?: string }
    return claims.aal === 'aal2'
  } catch {
    return false
  }
}
