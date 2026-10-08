export type Role = 'user' | 'vet' | 'cavd'

export type Profile = {
  id: string
  role: Role
  registration_kind: 'user' | 'vet'
  name: string
  contact: string | null
  clinic_name: string | null
  is_active: boolean
  verification_exempt: boolean
  location: string | null
  birth_date: string | null
  avatar_path: string | null
  created_at: string
}

export type VerificationRequest = {
  id: string
  user_id: string
  requested_role: 'user' | 'vet'
  id_type: 'national_id' | 'drivers_license' | 'passport' | 'other_government_id' | 'prc_id'
  id_path: string | null
  clinic_name: string | null
  prc_number: string | null
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type Pet = {
  id: string
  qr_slug: string
  owner_id: string | null
  source: 'owner' | 'shelter'
  registry_status: 'pending' | 'approved' | 'rejected'
  name: string
  species: 'dog' | 'cat' | 'other'
  breed: string | null
  sex: 'male' | 'female'
  size: 'small' | 'medium' | 'large'
  birth_date: string
  weight_kg: number | null
  color: string | null
  markings: string | null
  about: string | null
  photo_url: string | null
  sterilized: boolean
  rabies_vaccinated: boolean
  rabies_vaccinated_on: string | null
  registry_note: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export type Visit = {
  id: string
  pet_id: string
  recorded_by: string
  recorded_by_name: string
  clinic_name: string
  visit_date: string
  visit_type: 'checkup' | 'vaccination' | 'illness' | 'emergency' | 'follow_up' | 'other'
  reason: string | null
  summary: string
  history: string | null
  weight_kg: number | null
  exam_findings: string | null
  assessment: string | null
  diagnostics: string | null
  procedures: string | null
  medications: string | null
  owner_instructions: string | null
  follow_up_on: string | null
  vaccine_name: string | null
  vaccine_manufacturer: string | null
  vaccine_lot: string | null
  vaccine_expires_on: string | null
  vaccine_route: string | null
  vaccine_site: string | null
  vaccine_administered_by: string | null
  vaccine_next_due_on: string | null
  vaccine_adverse_event: string | null
  evidence_path: string | null
  verification_status: 'legacy_summary' | 'vet_confirmed' | 'cavd_confirmed'
  created_at: string
  corrected_by: string | null
  corrected_at: string | null
  correction_note: string | null
}

export type VisitCorrection = {
  id: string
  visit_id: string
  corrected_at: string
  correction_note: string
  previous_record: { summary: string }
  corrected_record: { summary: string }
}

export type Listing = {
  id: string
  pet_id: string
  listed_by: string
  status: 'pending' | 'approved' | 'rejected' | 'closed'
  notes: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export type Application = {
  id: string
  listing_id: string
  adopter_id: string
  message: string | null // retained only for applications submitted before migration 0012
  pet_name_snapshot: string | null
  answers_json: Record<string, string> | null
  application_source: 'legacy' | 'explore' | 'match'
  compatibility_score: number | null
  review_stage: 'pending_review' | 'under_review' | 'for_interview' | 'additional_requirements' | 'approved' | 'rejected'
  cavd_remarks: string | null
  applicant_response: string | null
  response_date: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  status: 'pending' | 'approved' | 'rejected'
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export type ApplicationEvent = {
  id: string
  application_id: string
  actor_id: string | null
  old_status: string | null
  new_status: Application['status']
  old_stage: string | null
  new_stage: Application['review_stage'] | null
  remarks: string | null
  created_at: string
}

export type AdoptionRecord = {
  id: string
  application_id: string
  listing_id: string
  pet_id: string
  previous_owner_id: string | null
  adopter_id: string
  approved_by: string
  approved_at: string
  validation_method: 'owner_conversation' | 'cavd_visit'
  validation_date: string
  validated_with: string
  decision_note: string | null
  pet_snapshot: {
    name: string
    species: string
    breed: string | null
    birth_date: string
    weight_kg: number | null
    color: string | null
    photo_url: string | null
  }
  last_visit_on: string | null
}

export type PublicListing = {
  listing_id: string
  pet_id: string
  listing_notes: string | null
  listed_at: string
  qr_slug: string
  name: string
  species: Pet['species']
  breed: string | null
  sex: Pet['sex']
  size: Pet['size']
  birth_date: string
  about: string | null
  photo_url: string | null
  sterilized: boolean
  rabies_vaccinated: boolean
  rabies_vaccinated_on: string | null
  source: Pet['source']
}

export type PetMatchTraits = {
  pet_id: string
  activity_level: number
  temperament: 'calm' | 'friendly' | 'playful' | 'independent' | 'protective'
  child_compatible: boolean
  pet_compatible: boolean
  space_need: number
  time_need: number
  experience_need: number
  updated_by: string
  updated_at: string
}

export type AdopterPreferences = {
  user_id: string
  preferred_species: 'any' | 'dog' | 'cat'
  preferred_size: 'any' | Pet['size']
  preferred_age: 'any' | 'baby' | 'young' | 'adult' | 'senior'
  activity_preference: number
  temperament_preference: 'any' | PetMatchTraits['temperament']
  living_space: number
  time_availability: number
  children_at_home: boolean
  other_pets_at_home: boolean
  ownership_experience: number
  updated_at?: string
}

export type PublicPet = {
  qr_slug: string
  name: string
  species: Pet['species']
  breed: string | null
  sex: Pet['sex']
  size: Pet['size']
  birth_date: string
  photo_url: string | null
  sterilized: boolean
  rabies_vaccinated: boolean
  rabies_vaccinated_on: string | null
  source: Pet['source']
  is_listed: boolean
  listing_id: string | null
}
