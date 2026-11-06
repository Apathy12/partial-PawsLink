import type { AdopterPreferences, PetMatchTraits, PublicListing } from './types'

export const MATCH_WEIGHTS = {
  species: 0.1, size: 0.1, age: 0.1, activity: 0.1, temperament: 0.1,
  space: 0.1, time: 0.1, children: 0.1, other_pets: 0.1, experience: 0.1
} as const

export type MatchCriterion = keyof typeof MATCH_WEIGHTS
export type MatchWeights = Record<MatchCriterion, number>
export const MATCH_CRITERIA = Object.keys(MATCH_WEIGHTS) as MatchCriterion[]

export function validMatchWeights(value: unknown): value is MatchWeights {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const weights = value as Record<string, unknown>
  return Object.keys(weights).length === MATCH_CRITERIA.length && MATCH_CRITERIA.every(key =>
    typeof weights[key] === 'number' && Number.isFinite(weights[key]) && (weights[key] as number) >= 0 && (weights[key] as number) <= 1) &&
    Math.abs(MATCH_CRITERIA.reduce((sum, key) => sum + (weights[key] as number), 0) - 1) <= 0.000001
}
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

type PreferenceAnswers = Omit<AdopterPreferences, 'user_id' | 'updated_at'>

export const LEVEL_LABELS = ['Very low', 'Low', 'Moderate', 'High', 'Very high']
export const SPACE_LABELS = ['Small room', 'Compact home', 'Average home', 'Large home', 'Large home with yard']
export const EXPERIENCE_LABELS = ['First-time owner', 'Some exposure', 'Some experience', 'Experienced', 'Very experienced']
export const SIZE_VALUES: PreferenceAnswers['preferred_size'][] = ['any', 'small', 'medium', 'large']
export const SIZE_LABELS = ['No preference', 'Small', 'Medium', 'Large']
export const AGE_VALUES: PreferenceAnswers['preferred_age'][] = ['any', 'baby', 'young', 'adult', 'senior']
export const AGE_LABELS = ['No preference', 'Under 1 year', '1–3 years', '3–7 years', '7 years and over']
export const TEMPERAMENT_VALUES: PreferenceAnswers['temperament_preference'][] = ['any', 'calm', 'friendly', 'playful', 'independent', 'protective']
export const TEMPERAMENT_LABELS = ['No preference', 'Calm', 'Friendly', 'Playful', 'Independent', 'Protective']

/** All 10 answers as shown on the Find My Match form, for read-only review. */
export function preferenceAnswerRows(answers: PreferenceAnswers): [string, string][] {
  return [
    ['Preferred animal type', answers.preferred_species === 'any' ? 'No preference' : answers.preferred_species === 'dog' ? 'Dog' : 'Cat'],
    ['Children in your home?', answers.children_at_home ? 'Yes' : 'No'],
    ['Pet coexistence', answers.other_pets_at_home ? 'Has other pets at home' : 'No other pets at home'],
    ['Preferred size', SIZE_LABELS[SIZE_VALUES.indexOf(answers.preferred_size)]],
    ['Preferred age', AGE_LABELS[AGE_VALUES.indexOf(answers.preferred_age)]],
    ['Your preferred activity level', LEVEL_LABELS[answers.activity_preference - 1]],
    ['Preferred temperament', TEMPERAMENT_LABELS[TEMPERAMENT_VALUES.indexOf(answers.temperament_preference)]],
    ['Living-space capacity', SPACE_LABELS[answers.living_space - 1]],
    ['Time available for daily care', LEVEL_LABELS[answers.time_availability - 1]],
    ['Pet ownership experience', EXPERIENCE_LABELS[answers.ownership_experience - 1]]
  ]
}

export function matchDraftKey(userId: string) {
  return `pawslink-match-draft:${userId}`
}

/** Unsaved answers win only when they are newer than the saved preferences. */
export function parseMatchDraft(raw: string | null, savedUpdatedAt?: string | null): PreferenceAnswers | null {
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as { answers?: Record<string, unknown>; saved_at?: string }
    const answers = draft.answers
    if (!answers || !(Object.keys(DEFAULT_PREFERENCES) as (keyof PreferenceAnswers)[])
      .every(key => typeof answers[key] === typeof DEFAULT_PREFERENCES[key])) return null
    if (savedUpdatedAt && !(Date.parse(draft.saved_at || '') > Date.parse(savedUpdatedAt))) return null
    return answers as PreferenceAnswers
  } catch {
    return null
  }
}

export const CRITERION_LABELS: Record<MatchCriterion, string> = {
  species: 'animal type', size: 'size', age: 'age', activity: 'activity level',
  temperament: 'temperament', space: 'living space', time: 'daily care time',
  children: 'children compatibility', other_pets: 'pet coexistence',
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
  today = new Date(),
  weights: MatchWeights = MATCH_WEIGHTS
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
    .reduce((sum, key) => sum + weights[key] * breakdown[key], 0)
  return { listing, score: Math.round(weighted * 1000) / 10, breakdown }
}

/**
 * Stage 1 of matching: the few conditions that exclude a pet before scoring.
 * CAVD eligibility is already applied by the public listing view. An animal-type
 * mismatch is excluded, as is recorded incompatibility with children or other pets
 * in the adopter's home: recommending such a pet would be a safety risk, so it is
 * not merely a lower score. Every other preference is scored in Stage 2.
 */
export function matchesPreferences(
  preferences: AdopterPreferences,
  listing: PublicListing,
  traits: PetMatchTraits
): boolean {
  return exact(preferences.preferred_species, listing.species) === 1 &&
    (!preferences.children_at_home || traits.child_compatible) &&
    (!preferences.other_pets_at_home || traits.pet_compatible)
}

export function rankListings(
  listings: PublicListing[],
  traits: PetMatchTraits[],
  preferences: AdopterPreferences,
  today = new Date(),
  weights: MatchWeights = MATCH_WEIGHTS
): MatchResult[] {
  const byPet = new Map(traits.map(trait => [trait.pet_id, trait]))
  // The listing view contains CAVD-approved, open records only.
  return listings.flatMap(listing => {
    const trait = byPet.get(listing.pet_id)
    return trait && matchesPreferences(preferences, listing, trait)
      ? [scoreListing(preferences, listing, trait, today, weights)] : []
  }).sort((a, b) => b.score - a.score || a.listing.name.localeCompare(b.listing.name))
}
