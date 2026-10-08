import type { Profile, VerificationRequest } from './types'

type AccountUser = { user_metadata: Record<string, unknown> }

// This flag controls the welcome flow only. Database policies still enforce access.
export function needsProfileSetup(profile: Profile, user: AccountUser) {
  return profile.role === 'user'
    && profile.registration_kind !== 'vet'
    && user.user_metadata.profile_setup_complete === false
}

export function accountDestination(profile: Profile, user: AccountUser, verification: VerificationRequest | null) {
  if (needsProfileSetup(profile, user)) return '/app/profile'
  if (profile.verification_exempt === false && verification?.status !== 'approved') return '/verify'
  return profile.role === 'cavd' ? '/office' : profile.role === 'vet' ? '/vet' : '/app'
}
