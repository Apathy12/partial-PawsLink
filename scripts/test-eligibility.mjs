import assert from 'node:assert/strict'
import { eligibilityReasons } from '../src/lib/eligibility.ts'

const today = '2026-10-19'
const pet = { registry_status: 'approved', sterilized: true, rabies_vaccinated: true, rabies_vaccinated_on: '2026-10-01' }
const checks = { availability: 'available', vaccination_status: 'current', vaccination_valid_until: today,
  behavioral_clearance: 'cleared', verified_by: 'staff', verified_at: '2026-10-18T12:00:00Z' }
assert.deepEqual(eligibilityReasons(pet, checks, 'cleared', today), [])
for (const [clearance, reason] of [['hold', '(Hold)'], ['pending', '(Pending)'], [null, '(no visit recorded)']])
  assert.ok(eligibilityReasons(pet, checks, clearance, today).some(row => row === `Latest veterinary visit is not Cleared ${reason}`), String(clearance))
assert.ok(eligibilityReasons(pet, null, 'cleared', today).some(reason => /verification/.test(reason)))
assert.ok(eligibilityReasons(pet, { ...checks, availability: 'hold' }, 'cleared', today).some(reason => /availability/.test(reason)))
assert.ok(eligibilityReasons(pet, { ...checks, availability: 'adopted' }, 'cleared', today).some(reason => /availability/.test(reason)))
assert.ok(eligibilityReasons(pet, { ...checks, vaccination_valid_until: '2026-10-18' }, 'cleared', today).some(reason => /vaccination/.test(reason)))
assert.ok(eligibilityReasons({ ...pet, rabies_vaccinated_on: '2026-10-20' }, checks, 'cleared', today).some(reason => /vaccination/.test(reason)))
assert.ok(eligibilityReasons({ ...pet, rabies_vaccinated: false }, checks, 'cleared', today).some(reason => /vaccination/.test(reason)))
assert.ok(eligibilityReasons({ ...pet, sterilized: false }, checks, 'cleared', today).some(reason => /Spay/.test(reason)))
assert.ok(eligibilityReasons(pet, { ...checks, behavioral_clearance: 'not_cleared' }, 'cleared', today).some(reason => /Behavioral/.test(reason)))
assert.ok(eligibilityReasons(pet, { ...checks, verified_by: null }, 'cleared', today).some(reason => /verification/.test(reason)))
assert.ok(eligibilityReasons({ ...pet, registry_status: 'pending' }, checks, 'cleared', today).some(reason => /Registration/.test(reason)))
// The database repeats these rules; test-rls.mjs proves Hold and Pending pets leave
// public_listings, public_pets.is_listed and the application functions.
console.log('Adoption eligibility checks passed.')
