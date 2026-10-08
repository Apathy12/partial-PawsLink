import assert from 'node:assert/strict'
import {
  APPLICATION_SECTIONS, fieldApplies, normalizedAnswers, stageLabel, validateAnswers
} from '../src/lib/adoption-application.ts'

const answers = Object.fromEntries(APPLICATION_SECTIONS.flatMap(section =>
  section.fields.map(field => [field.key, field.options?.[0] || 'Provided answer'])))
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
console.log('Adoption application checks passed.')
