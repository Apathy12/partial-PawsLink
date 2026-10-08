import assert from 'node:assert/strict'
import { accountDestination } from '../src/lib/onboarding.ts'

const owner = { role: 'user', registration_kind: 'user', verification_exempt: false }
const vetApplicant = { ...owner, registration_kind: 'vet' }
const newOwner = { user_metadata: { requested_role: 'user', profile_setup_complete: false } }
const completedOwner = { user_metadata: { requested_role: 'user', profile_setup_complete: true } }
const approved = { status: 'approved' }
const cases = [
  ['new owner starts with profile before ID upload', owner, newOwner, null, '/app/profile'],
  ['owner still completes profile if editable metadata changes', owner, { user_metadata: { requested_role: 'vet', profile_setup_complete: false } }, null, '/app/profile'],
  ['approved new owner still gets profile setup', owner, newOwner, approved, '/app/profile'],
  ['profile save continues to required ID upload', owner, completedOwner, null, '/verify'],
  ['owner enters education home after ID upload', owner, completedOwner, approved, '/app'],
  ['returning owner is not enrolled retroactively', owner, { user_metadata: {} }, approved, '/app'],
  ['demo owner goes to home', { ...owner, verification_exempt: true }, { user_metadata: {} }, null, '/app'],
  ['vet applicant still goes to PRC review', vetApplicant, { user_metadata: { requested_role: 'vet' } }, null, '/verify'],
  ['pending PRC request keeps veterinary applicant waiting', vetApplicant, { user_metadata: { requested_role: 'vet' } }, { status: 'pending' }, '/verify'],
  ['vet registration stays on PRC path even if user metadata changes', vetApplicant, newOwner, null, '/verify'],
  ['approved vet goes to clinic', { role: 'vet', verification_exempt: false }, newOwner, approved, '/vet'],
  ['CAVD goes to office', { role: 'cavd', verification_exempt: true }, newOwner, null, '/office']
]

for (const [name, profile, user, verification, expected] of cases) {
  assert.equal(accountDestination(profile, user, verification), expected, name)
  console.log(`PASS ${name}`)
}
