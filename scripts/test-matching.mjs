import assert from 'node:assert/strict'
import { DEFAULT_PREFERENCES, MATCH_WEIGHTS, listingAgeGroup, rankListings, scoreListing } from '../src/lib/matching.ts'
import { DEMO_MATCH_LISTINGS, DEMO_MATCH_TRAITS } from '../src/lib/match-demo.ts'

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
const ranked = rankListings([bruno, luna, { ...luna, listing_id: 'missing', pet_id: 'missing' }],
  [lunaTraits, brunoTraits], preference, today)
assert.deepEqual(ranked.map(row => row.listing.name), ['Luna', 'Bruno'])
assert.ok(ranked[0].score > ranked[1].score)
const demo = rankListings(DEMO_MATCH_LISTINGS, DEMO_MATCH_TRAITS, preference, today)
assert.equal(demo.length, 5)
assert.equal(new Set(demo.map(row => row.listing.pet_id)).size, 5)
console.log('Adopter matching checks passed.')
