import type { AdopterPreferences, PetMatchTraits, PublicListing } from './types'

export const MATCH_WEIGHTS = {
  species: 0.1, size: 0.1, age: 0.1, activity: 0.1, temperament: 0.1,
  space: 0.1, time: 0.1, children: 0.1, other_pets: 0.1, experience: 0.1
} as const

export type MatchCriterion = keyof typeof MATCH_WEIGHTS
export type MatchResult = {
  listing: PublicListing
  score: number
  breakdown: Record<MatchCriterion, number>
}

export const DEFAULT_PREFERENCES: Omit<AdopterPreferences, 'user_id' | 'updated_at'> = {
  preferred_species: 'any', preferred_size: 'any', preferred_age: 'any',
  activity_preference: 3, temperament_preference: 'any', living_space: 3,
  time_availability: 3, children_at_home: false, other_pets_at_home: false,
  ownership_experience: 3
}

export const CRITERION_LABELS: Record<MatchCriterion, string> = {
  species: 'animal type', size: 'size', age: 'age', activity: 'activity level',
  temperament: 'temperament', space: 'living space', time: 'daily care time',
  children: 'children compatibility', other_pets: 'other-pet compatibility',
  experience: 'ownership experience'
}

export function listingAgeGroup(birthDate: string, today = new Date()): AdopterPreferences['preferred_age'] {
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return 'any'
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth()
  if (today.getDate() < birth.getDate()) months--
  if (months < 12) return 'baby'
  if (months < 36) return 'young'
  if (months < 84) return 'adult'
  return 'senior'
}

function exact(preferred: string, actual: string): number {
  return preferred === 'any' || preferred === actual ? 1 : 0
}

function ordinal(preferred: number, actual: number): number {
  return Math.max(0, 1 - Math.abs(preferred - actual) / 4)
}

function capacity(available: number, needed: number): number {
  if (available >= needed) return 1
  return available + 1 === needed ? 0.5 : 0
}

export function scoreListing(
  preferences: AdopterPreferences,
  listing: PublicListing,
  traits: PetMatchTraits,
  today = new Date()
): MatchResult {
  const breakdown: Record<MatchCriterion, number> = {
    species: exact(preferences.preferred_species, listing.species),
    size: exact(preferences.preferred_size, listing.size),
    age: exact(preferences.preferred_age, listingAgeGroup(listing.birth_date, today)),
    activity: ordinal(preferences.activity_preference, traits.activity_level),
    temperament: exact(preferences.temperament_preference, traits.temperament),
    space: capacity(preferences.living_space, traits.space_need),
    time: capacity(preferences.time_availability, traits.time_need),
    children: !preferences.children_at_home || traits.child_compatible ? 1 : 0,
    other_pets: !preferences.other_pets_at_home || traits.pet_compatible ? 1 : 0,
    experience: capacity(preferences.ownership_experience, traits.experience_need)
  }
  const weighted = (Object.keys(MATCH_WEIGHTS) as MatchCriterion[])
    .reduce((sum, key) => sum + MATCH_WEIGHTS[key] * breakdown[key], 0)
  return { listing, score: Math.round(weighted * 1000) / 10, breakdown }
}

export function rankListings(
  listings: PublicListing[],
  traits: PetMatchTraits[],
  preferences: AdopterPreferences,
  today = new Date()
): MatchResult[] {
  const byPet = new Map(traits.map(trait => [trait.pet_id, trait]))
  // The listing view contains CAVD-approved, open records only.
  return listings.flatMap(listing => {
    const trait = byPet.get(listing.pet_id)
    return trait ? [scoreListing(preferences, listing, trait, today)] : []
  }).sort((a, b) => b.score - a.score || a.listing.name.localeCompare(b.listing.name))
}
