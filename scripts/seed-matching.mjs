/** Add five labeled sample pets, open listings, and matching traits. */
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !service) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (usersError) throw usersError
const cavdId = users.users.find(user => user.email === 'cavd@demo.local')?.id
if (!cavdId) throw new Error('Create the demo accounts with npm run seed first.')

// Fail before creating any pets if the matching migration has not been applied.
const { error: schemaError } = await admin.from('pet_match_traits').select('pet_id').limit(1)
if (schemaError) throw new Error(`${schemaError.message}. Apply migration 0011 before seeding matching pets.`)

function yearsAgo(years, months = 0) {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - years * 12 - months)
  return date.toISOString().slice(0, 10)
}

const pets = [
  {
    slug: 'demoluna', name: 'Luna (demo)', species: 'dog', sex: 'female', size: 'medium',
    birthDate: yearsAgo(2), breed: 'Mixed breed', color: 'Tan', photo: 'luna.webp',
    about: 'Demo pet for matching practice. Gentle and people-oriented; enjoys calm company and daily walks.',
    traits: { activity_level: 3, temperament: 'calm', child_compatible: true, pet_compatible: true, space_need: 3, time_need: 3, experience_need: 2 }
  },
  {
    slug: 'demobrun', name: 'Bruno (demo)', species: 'dog', sex: 'male', size: 'large',
    birthDate: yearsAgo(5), breed: 'Mixed breed', color: 'Brown', photo: 'bruno.webp',
    about: 'Demo pet for matching practice. Affectionate and active; does best with ample space and exercise.',
    traits: { activity_level: 4, temperament: 'friendly', child_compatible: true, pet_compatible: false, space_need: 5, time_need: 4, experience_need: 4 }
  },
  {
    slug: 'demomilo', name: 'Milo (demo)', species: 'cat', sex: 'male', size: 'small',
    birthDate: yearsAgo(0, 10), breed: 'Domestic shorthair', color: 'Orange', photo: 'milo.webp',
    about: 'Demo pet for matching practice. Curious and playful, with a good fit for indoor living.',
    traits: { activity_level: 4, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 3, experience_need: 2 }
  },
  {
    slug: 'demococo', name: 'Coco (demo)', species: 'cat', sex: 'female', size: 'small',
    birthDate: yearsAgo(4), breed: 'Domestic shorthair', color: 'Black', photo: 'coco.webp',
    about: 'Demo pet for matching practice. Quiet and independent; suited to a calmer household.',
    traits: { activity_level: 2, temperament: 'independent', child_compatible: true, pet_compatible: false, space_need: 1, time_need: 2, experience_need: 1 }
  },
  {
    slug: 'demopepr', name: 'Pepper (demo)', species: 'dog', sex: 'female', size: 'small',
    birthDate: yearsAgo(0, 8), breed: 'Mixed breed', color: 'White and brown', photo: 'pepper.webp',
    about: 'Demo pet for matching practice. Energetic and social; loves attention and games.',
    traits: { activity_level: 5, temperament: 'playful', child_compatible: true, pet_compatible: true, space_need: 2, time_need: 4, experience_need: 2 }
  }
]

for (const pet of pets) {
  const { data: existing, error: lookupError } = await admin.from('pets')
    .select('id,owner_id,registry_status,photo_url').eq('qr_slug', pet.slug).maybeSingle()
  if (lookupError) throw lookupError
  let petId = existing?.id
  if (!petId) {
    const { data, error } = await admin.from('pets').insert({
      qr_slug: pet.slug, owner_id: null, created_by: cavdId, source: 'shelter', registry_status: 'approved',
      name: pet.name, species: pet.species, breed: pet.breed, sex: pet.sex, size: pet.size,
      birth_date: pet.birthDate, color: pet.color, about: pet.about,
      photo_url: `/demo-pets/${pet.photo}`, sterilized: true, rabies_vaccinated: true,
      rabies_vaccinated_on: new Date().toISOString().slice(0, 10),
      registry_note: 'Sample record for the adopter matching demonstration.',
      decided_by: cavdId, decided_at: new Date().toISOString()
    }).select('id').single()
    if (error) throw error
    petId = data.id
    console.log('created sample pet:', pet.name)
  } else {
    console.log('kept existing sample pet:', pet.name)
    if (existing.photo_url === `/demo-pets/${pet.photo.replace('.webp', '.svg')}`) {
      const { error } = await admin.from('pets').update({ photo_url: `/demo-pets/${pet.photo}` }).eq('id', petId)
      if (error) throw error
      console.log('updated sample photo:', pet.name)
    }
  }

  // Never reopen a listing that CAVD closed or that ended in adoption.
  if (!existing || existing.registry_status === 'approved' && existing.owner_id === null) {
    const { data: listings, error: listError } = await admin.from('listings')
      .select('id,status').eq('pet_id', petId).limit(1)
    if (listError) throw listError
    if (!listings?.length) {
      const { error } = await admin.from('listings').insert({
        pet_id: petId, listed_by: cavdId, status: 'approved',
        notes: 'Demo listing for testing only. This is not a real adoption offer.',
        decided_by: cavdId, decided_at: new Date().toISOString()
      })
      if (error) throw error
      console.log('published sample listing:', pet.name)
    }
  }

  const { data: traitRow, error: traitLookupError } = await admin.from('pet_match_traits')
    .select('pet_id').eq('pet_id', petId).maybeSingle()
  if (traitLookupError) throw traitLookupError
  if (!traitRow) {
    const { error } = await admin.from('pet_match_traits').insert({ pet_id: petId, updated_by: cavdId, ...pet.traits })
    if (error) throw error
    console.log('added matching traits:', pet.name)
  }
}

console.log('Sample pet seed complete. Sign in as adopter@demo.local and open /app/match.')
