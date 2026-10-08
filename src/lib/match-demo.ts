import type { PetMatchTraits, PublicListing } from './types'
import { assetUrl } from './format'

function yearsAgo(years: number, months = 0) {
  const date = new Date()
  date.setMonth(date.getMonth() - years * 12 - months)
  return date.toISOString().slice(0, 10)
}

const sample = [
  { key: 'luna', name: 'Luna', species: 'dog', sex: 'female', size: 'medium', birthDate: yearsAgo(2),
    breed: 'Mixed breed', about: 'Gentle and people-oriented; enjoys calm company and daily walks.',
    activity_level: 3, temperament: 'calm', child_compatible: true, pet_compatible: true, space_need: 3, time_need: 3, experience_need: 2 },
  { key: 'bruno', name: 'Bruno', species: 'dog', sex: 'male', size: 'large', birthDate: yearsAgo(5),
    breed: 'Mixed breed', about: 'Affectionate and active; does best with ample space and exercise.',
    activity_level: 4, temperament: 'friendly', child_compatible: true, pet_compatible: false, space_need: 5, time_need: 4, experience_need: 4 },
  { key: 'milo', name: 'Milo', species: 'cat', sex: 'male', size: 'small', birthDate: yearsAgo(0, 10),
    breed: 'Domestic shorthair', about: 'Curious and playful, with a good fit for indoor living.',
    activity_level: 4, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 3, experience_need: 2 },
  { key: 'coco', name: 'Coco', species: 'cat', sex: 'female', size: 'small', birthDate: yearsAgo(4),
    breed: 'Domestic shorthair', about: 'Quiet and independent; suited to a calmer household.',
    activity_level: 2, temperament: 'independent', child_compatible: true, pet_compatible: false, space_need: 1, time_need: 2, experience_need: 1 },
  { key: 'pepper', name: 'Pepper', species: 'dog', sex: 'female', size: 'small', birthDate: yearsAgo(0, 8),
    breed: 'Mixed breed', about: 'Energetic and social; loves attention and games.',
    activity_level: 5, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 4, experience_need: 2 }
] as const

export const DEMO_MATCH_LISTINGS: PublicListing[] = sample.map(pet => ({
  listing_id: `demo-${pet.key}`, pet_id: `demo-pet-${pet.key}`, listing_notes: 'Sample only',
  listed_at: new Date().toISOString(), qr_slug: `demo${pet.key}`,
  name: `${pet.name} (demo)`, species: pet.species, breed: pet.breed, sex: pet.sex,
  size: pet.size, birth_date: pet.birthDate, about: pet.about,
  photo_url: assetUrl(`/demo-pets/${pet.key}.webp`), sterilized: true, rabies_vaccinated: true,
  rabies_vaccinated_on: null, source: 'shelter'
}))

export const DEMO_MATCH_TRAITS: PetMatchTraits[] = sample.map(pet => ({
  pet_id: `demo-pet-${pet.key}`, activity_level: pet.activity_level,
  temperament: pet.temperament, child_compatible: pet.child_compatible,
  pet_compatible: pet.pet_compatible, space_need: pet.space_need, time_need: pet.time_need,
  experience_need: pet.experience_need, updated_by: 'demo', updated_at: new Date().toISOString()
}))
