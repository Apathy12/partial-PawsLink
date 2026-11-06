import assert from 'node:assert/strict'
import { preferenceAnswerRows } from '../src/lib/matching.ts'
import {
  APPLICATION_SECTIONS, applicationActionLabel, applicationPath, fieldApplies, needsApplicationForm, normalizedAnswers, stageLabel, validateAnswers
} from '../src/lib/adoption-application.ts'

const answers = Object.fromEntries(APPLICATION_SECTIONS.flatMap(section =>
  section.fields.map(field => [field.key, field.options?.[0] || 'Provided answer'])))
const emptyRequest = { id: 'request', status: 'pending', answers_json: null, application_source: 'direct' }
assert.equal(needsApplicationForm(undefined), true)
assert.equal(needsApplicationForm(emptyRequest), true)
assert.equal(applicationPath('listing'), '/app/listings/listing/apply?source=explore')
assert.equal(applicationPath('listing', emptyRequest), '/app/listings/listing/apply?source=explore')
assert.equal(applicationActionLabel(emptyRequest), 'Complete application')
assert.equal(applicationActionLabel(), 'Apply for adoption')
assert.equal(applicationPath('listing', { ...emptyRequest, answers_json: { full_name: 'Applicant' } }), '/app/applications/request')
assert.equal(applicationActionLabel({ ...emptyRequest, status: 'rejected' }), 'View application')
Object.assign(answers, {
  email: 'adopter@example.com', birth_date: '1995-01-01', hours_alone: '3',
  children_present: 'No', current_pets: 'No', ownership_experience: 'First-time owner',
  household_support: 'Yes'
})

assert.deepEqual(validateAnswers(answers, true), [])
assert.equal(fieldApplies('children', answers), false)
assert.equal(fieldApplies('current_details', answers), false)
assert.equal(fieldApplies('previous_details', answers), false)
assert.equal(fieldApplies('support_details', answers), false)
assert.equal(normalizedAnswers(answers).children, 'Not applicable')

assert.ok(validateAnswers({ ...answers, children_present: 'Yes', children: '' }, true)
  .some(message => message.includes('Ages of children')))
assert.ok(validateAnswers({ ...answers, current_pets: 'Yes', current_details: '' }, true)
  .some(message => message.includes('Describe current pets')))
assert.ok(validateAnswers({ ...answers, household_support: 'No', support_details: '' }, true)
  .some(message => message.includes('household agreement')))
assert.ok(validateAnswers({ ...answers, birth_date: '2024-02-31' }, true)
  .some(message => message.includes('birth date')))
assert.ok(validateAnswers({ ...answers, hours_alone: '25' }, true)
  .some(message => message.includes('between 0 and 24')))
assert.ok(validateAnswers({ ...answers, email: 'not-an-email' }, true)
  .some(message => message.includes('email')))
assert.ok(validateAnswers(answers, false).some(message => message.includes('Confirm')))
assert.equal(stageLabel('for_interview', 'pending'), 'For interview')
// A stamped snapshot renders all 10 answers with the Find My Match labels.
const stamped = {
  preferred_species: 'dog', preferred_size: 'small', preferred_age: 'young', activity_preference: 3,
  temperament_preference: 'calm', living_space: 3, time_availability: 5, children_at_home: true,
  other_pets_at_home: false, ownership_experience: 1
}
const rows = Object.fromEntries(preferenceAnswerRows(stamped))
assert.equal(Object.keys(rows).length, 10)
assert.equal(rows['Preferred animal type'], 'Dog')
assert.equal(rows['Pet coexistence'], 'No other pets at home')
assert.equal(rows['Preferred age'], '1–3 years')
assert.equal(rows['Living-space capacity'], 'Average home')
assert.equal(rows['Time available for daily care'], 'Very high')
assert.equal(rows['Children in your home?'], 'Yes')
assert.equal(rows['Pet ownership experience'], 'First-time owner')
assert.ok(Object.values(rows).every(Boolean), 'every answer has a label')
console.log('Adoption application checks passed.')
