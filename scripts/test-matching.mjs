import assert from 'node:assert/strict'
import { DEFAULT_PREFERENCES, MATCH_WEIGHTS, listingAgeGroup, matchDraftKey, matchesPreferences, parseMatchDraft, preferenceAnswerRows, rankListings, scoreListing, validMatchWeights } from '../src/lib/matching.ts'
import { DEMO_COVERAGE_PETS, DEMO_PETS } from './demo-match-data.mjs'

const today = new Date('2026-10-08T12:00:00Z')
const preference = {
  ...DEFAULT_PREFERENCES, user_id: 'adopter', preferred_species: 'dog', preferred_size: 'medium',
  preferred_age: 'young', activity_preference: 3, temperament_preference: 'calm',
  living_space: 3, time_availability: 3, ownership_experience: 2
}
const luna = { listing_id: 'listing-luna', pet_id: 'pet-luna', name: 'Luna', species: 'dog', size: 'medium', birth_date: '2024-10-09' }
const bruno = { listing_id: 'listing-bruno', pet_id: 'pet-bruno', name: 'Bruno', species: 'dog', size: 'large', birth_date: '2021-10-08' }
const lunaTraits = { pet_id: 'pet-luna', activity_level: 3, temperament: 'calm', child_compatible: true,
  pet_compatible: true, space_need: 3, time_need: 3, experience_need: 2 }
const brunoTraits = { pet_id: 'pet-bruno', activity_level: 4, temperament: 'friendly', child_compatible: true,
  pet_compatible: false, space_need: 5, time_need: 4, experience_need: 4 }

assert.ok(Math.abs(Object.values(MATCH_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < 1e-12)
assert.equal(listingAgeGroup('2025-10-09', today), 'baby')
assert.equal(listingAgeGroup('2025-10-08', today), 'young')
assert.equal(listingAgeGroup('2019-10-08', today), 'senior')
assert.equal(scoreListing(preference, luna, lunaTraits, today).score, 100)
assert.equal(scoreListing({ ...preference, other_pets_at_home: true }, bruno, brunoTraits, today).breakdown.other_pets, 0)
assert.equal(scoreListing({ ...preference, living_space: 4 }, bruno, brunoTraits, today).breakdown.space, 0.5)
// Stage 2 ranks partial matches instead of dropping them: Bruno differs on size, age,
// activity, temperament, space, care time and experience, so he ranks below Luna.
const ranked = rankListings([bruno, luna, { ...luna, listing_id: 'missing', pet_id: 'missing' }],
  [lunaTraits, brunoTraits], preference, today)
assert.deepEqual(ranked.map(row => row.listing.name), ['Luna', 'Bruno'])
assert.equal(ranked[0].score, 100)
assert.equal(ranked[1].score, 36.1)
assert.equal(matchesPreferences(preference, luna, lunaTraits), true)
// Each scored preference lowers the score; none of them removes the pet.
for (const changed of [
  { preferred_size: 'large' }, { preferred_age: 'senior' }, { temperament_preference: 'playful' },
  { activity_preference: 2 }, { activity_preference: 4 }, { living_space: 2 }, { time_availability: 2 }, { ownership_experience: 1 }
]) {
  const [match] = rankListings([luna], [lunaTraits], { ...preference, ...changed }, today)
  assert.ok(match && match.score < 100 && match.score >= 80, JSON.stringify(changed))
}
// Stage 1: only a different animal type excludes a pet. Household compatibility is scored.
assert.deepEqual(rankListings([luna], [lunaTraits], { ...preference, preferred_species: 'cat' }, today), [])
assert.equal(matchesPreferences({ ...preference, children_at_home: true }, luna, { ...lunaTraits, child_compatible: false }), true)
assert.equal(matchesPreferences({ ...preference, other_pets_at_home: true }, luna, { ...lunaTraits, pet_compatible: false }), true)
const noChildren = scoreListing({ ...preference, children_at_home: true }, luna, { ...lunaTraits, child_compatible: false }, today)
assert.equal(noChildren.breakdown.children, 0)
assert.equal(noChildren.score, 88.9)
assert.equal('species' in noChildren.breakdown, false, 'animal type is a filter, not a scored criterion')
assert.equal(Object.keys(MATCH_WEIGHTS).length, 9)
assert.equal(matchesPreferences(preference, luna, { ...lunaTraits, child_compatible: false, pet_compatible: false }), true)
assert.equal(matchesPreferences({ ...preference, preferred_species: 'any' }, { ...luna, species: 'cat' }, lunaTraits), true)
const seedListings = DEMO_PETS.map(pet => ({ ...pet, pet_id: pet.slug, listing_id: pet.slug, birth_date: pet.birthDate }))
const seedTraits = DEMO_PETS.map(pet => ({ ...pet.traits, pet_id: pet.slug }))
const species = Object.fromEntries(DEMO_PETS.map(pet => [pet.name, pet.species]))
const descending = rows => rows.every((row, i) => !i || rows[i - 1].score >= row.score)
const demo = rankListings(seedListings, seedTraits, preference, today)
assert.equal(demo[0].listing.name, 'Luna (demo)')
assert.equal(demo[0].score, 100)
assert.ok(demo.length > 1 && demo.slice(1).every(row => row.score < 100), 'other dogs rank below the full match')
assert.ok(demo.every(row => species[row.listing.name] === 'dog'), 'a dog preference never shows cats')
assert.ok(descending(demo))
assert.equal(new Set(demo.map(row => row.score)).size > 1, true, 'scores must vary between pets')
const broadPreferences = { ...DEFAULT_PREFERENCES, user_id: 'adopter', living_space: 5, time_availability: 5, ownership_experience: 5, activity_preference: 4 }
const broad = rankListings(seedListings, seedTraits, broadPreferences, today)
assert.equal(broad.length, DEMO_PETS.length)
assert.ok(descending(broad))
const cats = rankListings(seedListings, seedTraits, { ...broadPreferences, preferred_species: 'cat' }, today)
assert.deepEqual(cats.map(row => row.listing.name).sort(), DEMO_PETS.filter(pet => pet.species === 'cat').map(pet => pet.name).sort())
const family = rankListings(seedListings, seedTraits, { ...broadPreferences, activity_preference: 5, children_at_home: true, other_pets_at_home: true }, today)
assert.equal(family.length, DEMO_PETS.length, 'household incompatibility lowers the score instead of excluding the pet')
assert.ok(family.filter(row => { const t = seedTraits.find(t => t.pet_id === row.listing.pet_id); return !t.child_compatible || !t.pet_compatible })
  .every(row => row.score < 100 && (row.breakdown.children === 0 || row.breakdown.other_pets === 0)))
assert.deepEqual(family.slice(0, 2).map(row => row.listing.name).sort(), ['Nala (demo)', 'Pepper (demo)'])
const largeCats = rankListings(seedListings, seedTraits, { ...broadPreferences, preferred_species: 'cat', preferred_size: 'large' }, today)
assert.ok(largeCats.length > 0 && largeCats.every(row => row.score < 100), 'no large cat exists, so cats rank lower instead of disappearing')
for (const pet of DEMO_PETS) assert.match(pet.slug, /^[a-z0-9]{8}$/)
assert.ok(DEMO_PETS.slice(5).every(pet => pet.photo === null))
assert.ok(demo.every(pet => Number.isFinite(pet.score) && pet.score >= 0 && pet.score <= 100))
assert.equal(validMatchWeights(MATCH_WEIGHTS), true)
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, size: .2 }), false)
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, size: -.1, age: 1 / 9 + .1 + 1 / 9 }), false)
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, size: String(1 / 9) }), false)
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, unknown: 0 }), false)
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, species: 0 }), false, 'animal type cannot be weighted')
assert.equal(validMatchWeights({ ...MATCH_WEIGHTS, size: NaN }), false)
const childrenOnly = Object.fromEntries(Object.keys(MATCH_WEIGHTS).map(key => [key, key === 'children' ? 1 : 0]))
assert.equal(validMatchWeights(childrenOnly), true)
assert.equal(rankListings([bruno], [brunoTraits], preference, today, childrenOnly)[0].score, 100)
assert.equal(scoreListing(preference, bruno, brunoTraits, today, childrenOnly).score, 100)
assert.equal(scoreListing({ ...preference, children_at_home: true }, bruno, { ...brunoTraits, child_compatible: false }, today, childrenOnly).score, 0)
// For each of the 600 coverage pets, answers describing exactly that pet must rank it
// first with a full score, ahead of every other pet of the same animal type.
const coverageToday = new Date()
const coverageListings = DEMO_COVERAGE_PETS.map(pet => ({ ...pet, pet_id: pet.slug, listing_id: pet.slug, birth_date: pet.birthDate }))
const coverageTraits = DEMO_COVERAGE_PETS.map(pet => ({ ...pet.traits, pet_id: pet.slug }))
assert.equal(DEMO_COVERAGE_PETS.length, 600)
assert.equal(new Set(DEMO_COVERAGE_PETS.map(pet => pet.slug)).size, 600)
for (const pet of DEMO_COVERAGE_PETS) {
  assert.match(pet.slug, /^[a-z0-9]{8}$/)
  assert.equal(pet.photo, null)
  const answers = { ...DEFAULT_PREFERENCES, user_id: 'coverage-adopter',
    preferred_species: pet.species, preferred_size: pet.size,
    preferred_age: listingAgeGroup(pet.birthDate, coverageToday), temperament_preference: pet.traits.temperament,
    activity_preference: pet.traits.activity_level, living_space: 1, time_availability: 1,
    ownership_experience: 1, children_at_home: true, other_pets_at_home: true }
  const matches = rankListings(coverageListings, coverageTraits, answers, coverageToday)
  assert.equal(matches[0]?.listing.pet_id, pet.slug, `Coverage missing for ${pet.slug}`)
  assert.equal(matches[0].score, 100)
  assert.ok(matches[1].score < 100, `Exact answers for ${pet.slug} must not tie with another pet`)
  assert.ok(matches.every(match => match.listing.species === pet.species))
}
assert.equal(rankListings(coverageListings, coverageTraits, {
  ...DEFAULT_PREFERENCES, user_id: 'coverage-adopter', living_space: 1, time_availability: 1,
  ownership_experience: 1, children_at_home: true, other_pets_at_home: true
}, coverageToday).length, 600)
// Unsaved answers survive leaving the page, and lose to newer saved preferences.
const draftAnswers = { ...DEFAULT_PREFERENCES, preferred_species: 'cat', children_at_home: true }
const draft = JSON.stringify({ answers: draftAnswers, saved_at: '2026-10-08T12:00:00Z' })
assert.equal(matchDraftKey('user-1'), 'pawslink-match-draft:user-1')
assert.deepEqual(parseMatchDraft(draft), draftAnswers)
assert.deepEqual(parseMatchDraft(draft, '2026-10-08T11:00:00Z'), draftAnswers)
assert.equal(parseMatchDraft(draft, '2026-10-08T13:00:00Z'), null)
assert.equal(parseMatchDraft('not json'), null)
assert.equal(parseMatchDraft(JSON.stringify({ answers: { preferred_species: 'cat' } })), null)
assert.equal(parseMatchDraft(null), null)
assert.equal(preferenceAnswerRows(DEFAULT_PREFERENCES).length, 10)
console.log('Adopter matching checks passed.')
