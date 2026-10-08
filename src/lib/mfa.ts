import type { Session } from '@supabase/supabase-js'

// This is only a route hint. SQL policies enforce aal2 for CAVD operations.
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
