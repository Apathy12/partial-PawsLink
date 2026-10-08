export type ApplicationField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'email' | 'tel' | 'date' | 'number' | 'select'
  options?: readonly string[]
}

export const APPLICATION_SECTIONS: { title: string; fields: ApplicationField[] }[] = [
  { title: 'Applicant information', fields: [
    { key: 'full_name', label: 'Full name', type: 'text' },
    { key: 'address', label: 'Home address', type: 'textarea' },
    { key: 'phone', label: 'Contact number', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'birth_date', label: 'Birth date', type: 'date' },
    { key: 'occupation', label: 'Occupation (or N/A)', type: 'text' },
    { key: 'alternate_contact', label: 'Alternate contact person', type: 'text' },
    { key: 'alternate_relationship', label: 'Relationship to applicant', type: 'text' },
    { key: 'alternate_phone', label: 'Alternate contact number', type: 'tel' }
  ] },
  { title: 'Household and living situation', fields: [
    { key: 'residence', label: 'Type of residence', type: 'select', options: ['House', 'Apartment', 'Condominium', 'Boarding house', 'Other'] },
    { key: 'housing', label: 'Do you own or rent your home?', type: 'select', options: ['Own', 'Rent', 'Other arrangement'] },
    { key: 'pets_allowed', label: 'Are pets permitted by the owner or property rules?', type: 'select', options: ['Yes', 'No', 'Not yet confirmed', 'Not applicable'] },
    { key: 'household', label: 'Who lives with you? (Write living alone if applicable.)', type: 'textarea' },
    { key: 'children_present', label: 'Children in the household?', type: 'select', options: ['Yes', 'No'] },
    { key: 'children', label: 'Ages of children in the household', type: 'textarea' },
    { key: 'elderly', label: 'Are there elderly household members?', type: 'select', options: ['Yes', 'No'] },
    { key: 'allergies', label: 'Does anyone in the household have animal allergies?', type: 'select', options: ['Yes', 'No', 'Unsure'] },
    { key: 'household_support', label: 'Does everyone in your household agree with the adoption?', type: 'select', options: ['Yes', 'No', 'Living alone'] },
    { key: 'support_details', label: 'Explain your household agreement or concerns', type: 'textarea' }
  ] },
  { title: 'Pet-care capacity', fields: [
    { key: 'caregiver', label: 'Who will feed, groom, and care for the pet?', type: 'textarea' },
    { key: 'financial_caregiver', label: 'Who will cover food and veterinary expenses?', type: 'textarea' },
    { key: 'hours_alone', label: 'Hours the pet will normally be alone each day', type: 'number' },
    { key: 'pet_space', label: 'Where will the pet live and sleep?', type: 'textarea' },
    { key: 'backup_care', label: 'Who will care for the pet during travel or emergencies?', type: 'textarea' },
    { key: 'care_plan', label: 'Describe your plan for food, vaccinations, veterinary care, grooming, exercise, and safe shelter', type: 'textarea' },
    { key: 'introduction', label: 'How will you help the pet adjust to your home and other household members or pets?', type: 'textarea' }
  ] },
  { title: 'Pet ownership experience', fields: [
    { key: 'ownership_experience', label: 'Pet ownership experience', type: 'select', options: ['First-time owner', 'Some exposure', 'Some experience', 'Experienced owner', 'Very experienced handler'] },
    { key: 'previous_details', label: 'Describe your previous pets and what happened to them', type: 'textarea' },
    { key: 'current_pets', label: 'Do you currently have pets?', type: 'select', options: ['Yes', 'No'] },
    { key: 'current_details', label: 'Describe current pets, including vaccination and spay/neuter status', type: 'textarea' }
  ] },
  { title: 'Adoption intent', fields: [
    { key: 'reason', label: 'Why do you want to adopt this pet?', type: 'textarea' },
    { key: 'behavior_plan', label: 'How would you respond to behavioral difficulties?', type: 'textarea' },
    { key: 'moving_plan', label: 'What will happen to your pet if you move?', type: 'textarea' }
  ] }
]

export type ApplicationAnswers = Record<string, string>

export function fieldApplies(key: string, answers: ApplicationAnswers): boolean {
  if (key === 'children') return answers.children_present !== 'No'
  if (key === 'current_details') return answers.current_pets !== 'No'
  if (key === 'previous_details') return answers.ownership_experience !== 'First-time owner'
  if (key === 'support_details') return answers.household_support === 'No'
  return true
}

export function normalizedAnswers(answers: ApplicationAnswers): ApplicationAnswers {
  return Object.fromEntries(APPLICATION_SECTIONS.flatMap(section => section.fields.map(field => [
    field.key, fieldApplies(field.key, answers) ? (answers[field.key] || '').trim() : 'Not applicable'
  ])))
}

export function todayInputDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= todayInputDate()
}

export function validateAnswers(answers: ApplicationAnswers, declared: boolean): string[] {
  const errors: string[] = []
  for (const section of APPLICATION_SECTIONS) for (const field of section.fields) {
    if (!fieldApplies(field.key, answers)) continue
    const value = (answers[field.key] || '').trim()
    if (!value) { errors.push(`${field.label} is required.`); continue }
    if (value.length > 3000) errors.push(`${field.label} must be 3,000 characters or fewer.`)
    if (field.options && !field.options.includes(value)) errors.push(`Choose a valid answer for ${field.label}.`)
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push('Enter a valid email address.')
    if (field.type === 'number' && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 24)) errors.push('Hours alone must be between 0 and 24.')
    if (field.type === 'date' && !validBirthDate(value)) errors.push('Enter a valid birth date that is not in the future.')
  }
  if (!declared) errors.push('Confirm that your application answers are accurate.')
  return errors
}

export type ReviewStage = 'pending_review' | 'under_review' | 'for_interview' | 'additional_requirements' | 'approved' | 'rejected'

export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  pending_review: 'Pending review', under_review: 'Under review',
  for_interview: 'For interview', additional_requirements: 'Additional requirements needed',
  approved: 'Approved', rejected: 'Rejected'
}

export function stageLabel(stage: ReviewStage | null | undefined, status: string): string {
  return stage ? REVIEW_STAGE_LABELS[stage] : status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending review'
}
