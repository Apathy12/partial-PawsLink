import type { Pet, Visit } from './types'

export type AdoptionChecks = {
  pet_id: string
  availability: 'available' | 'hold' | 'adopted'
  vaccination_status: 'current' | 'incomplete'
  vaccination_valid_until: string | null
  behavioral_clearance: 'pending' | 'cleared' | 'not_cleared'
  verified_by: string | null
  verified_at: string | null
  notes: string
  updated_at: string
}

export type EligibilityReport = {
  pet_id: string; name: string; qr_slug: string; photo_url: string | null
  registry_status: Pet['registry_status']; availability: AdoptionChecks['availability']
  eligible: boolean; reasons: string[]; latest_clearance: Visit['clearance_status'] | null
}

export const CLEARANCE_LABELS: Record<Visit['clearance_status'], string> = { cleared: 'Cleared', hold: 'Hold', pending: 'Pending' }

export const ADOPTION_RULES = [
  ['Registration', 'CAVD-approved pet registration'],
  ['Availability', 'Available; pets on Hold or already Adopted are excluded'],
  ['Vaccination', 'Rabies vaccination recorded, vaccination status Current, and valid-through date has not passed'],
  ['Spay / neuter', 'Completed in the pet health record'],
  ['Behavior', 'Behavioral clearance recorded as Cleared'],
  ['Veterinary clearance', 'Latest CAVD veterinary visit recorded as Cleared'],
  ['Verification', 'CAVD staff account and review date recorded'],
  ['Listing', 'CAVD-approved listing before browsing or applying']
] as const

/** Preview only. The database repeats these rules for every application. */
export function eligibilityReasons(pet: Pick<Pet, 'registry_status' | 'sterilized' | 'rabies_vaccinated' | 'rabies_vaccinated_on'>,
  checks: Partial<AdoptionChecks> | null, latestClearance: Visit['clearance_status'] | null | undefined,
  today = new Date().toISOString().slice(0, 10)): string[] {
  const reasons: string[] = []
  if (pet.registry_status !== 'approved') reasons.push('Registration is not approved')
  if (checks?.availability !== 'available') reasons.push('Adoption availability is not Available')
  if (!pet.rabies_vaccinated || !pet.rabies_vaccinated_on || pet.rabies_vaccinated_on > today ||
    checks?.vaccination_status !== 'current' || !checks.vaccination_valid_until || checks.vaccination_valid_until < today)
    reasons.push('Current vaccination and its valid-through date must be recorded')
  if (!pet.sterilized) reasons.push('Spay/neuter is not completed')
  if (checks?.behavioral_clearance !== 'cleared') reasons.push('Behavioral clearance is not Cleared')
  if (!checks?.verified_by || !checks.verified_at || checks.verified_at.slice(0, 10) > today)
    reasons.push('CAVD eligibility verification is not recorded or needs renewal')
  if (latestClearance !== 'cleared')
    reasons.push(`Latest veterinary visit is not Cleared (${latestClearance ? CLEARANCE_LABELS[latestClearance] : 'no visit recorded'})`)
  return reasons
}

export const eligibilitySetupMessage = 'Adoption eligibility needs a database update. Ask the administrator to apply the latest migrations.'
