/** Seed labeled demo pets. --ready-for-matching explicitly completes demo readiness. */
import { createClient } from '@supabase/supabase-js'
import { DEMO_COVERAGE_PETS, DEMO_PETS } from './demo-match-data.mjs'

const ready = process.argv.includes('--ready-for-matching')
const dryRun = process.argv.includes('--dry-run')
const coverage = process.argv.includes('--coverage')
const pets = coverage ? DEMO_COVERAGE_PETS : DEMO_PETS
const url = process.env.VITE_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !service) throw new Error('Missing Supabase configuration in .env.local')
const options = { auth: { autoRefreshToken: false, persistSession: false } }
const admin = createClient(url, service, options)
const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (usersError) throw usersError
const cavdId = users.users.find(user => user.email === 'cavd@demo.local')?.id
if (!cavdId) throw new Error('Create the demo CAVD account first.')
const { error: schemaError } = await admin.from('pet_match_traits').select('pet_id').limit(1)
if (schemaError) throw new Error('Apply matching migration 0011 before seeding.')
const { error: strictError } = await admin.from('pet_adoption_checks').select('pet_id').limit(1)
if (strictError && strictError.code !== 'PGRST205' && strictError.code !== '42P01') throw strictError
const strictAdoption = !strictError
if (ready && !strictAdoption) throw new Error('Apply migration 0018 before preparing demo eligibility.')

// Read bounded batches before any writes, then check each exact demo identity.
const chunks = (rows, size = 100) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size))
const existingPets = []
for (const batch of chunks(pets)) {
  const { data, error } = await admin.from('pets')
    .select('id,qr_slug,name,owner_id,source,created_by,registry_status,photo_url,sterilized,rabies_vaccinated,rabies_vaccinated_on')
    .in('qr_slug', batch.map(pet => pet.slug))
  if (error) throw error
  existingPets.push(...data)
}
const allListings = [], allChecks = [], allTraits = []
for (const batch of chunks(existingPets)) {
  const ids = batch.map(pet => pet.id)
  const results = await Promise.all([
    admin.from('listings').select('id,pet_id,status').in('pet_id', ids),
    strictAdoption ? admin.from('pet_adoption_checks').select('*').in('pet_id', ids) : Promise.resolve({ data: [], error: null }),
    admin.from('pet_match_traits').select('pet_id').in('pet_id', ids)
  ])
  for (const result of results) if (result.error) throw result.error
  allListings.push(...results[0].data); allChecks.push(...results[1].data); allTraits.push(...results[2].data)
}
const targets = []
for (const pet of pets) {
  const existing = existingPets.find(row => row.qr_slug === pet.slug)
  if (existing && (existing.name !== pet.name || existing.source !== 'shelter' || existing.created_by !== cavdId))
    throw new Error(`PET ID ${pet.slug} does not identify the expected demo record; stopped.`)
  const listings = allListings.filter(listing => listing.pet_id === existing?.id)
  const checks = allChecks.find(check => check.pet_id === existing?.id)
  if (existing && (existing.owner_id !== null || existing.registry_status !== 'approved' || checks?.availability === 'adopted' ||
    listings.some(listing => listing.status === 'closed' || listing.status === 'rejected'))) {
    console.log('Skipped adopted, owned, rejected or closed demo pet:', pet.name)
    continue
  }
  targets.push({ pet, existing, petId: existing?.id, listings, checks })
}
if (dryRun) {
  for (const { pet, existing } of targets.slice(0, coverage ? 5 : targets.length)) console.log(`${existing ? 'Keep' : 'Create'} ${pet.slug}: ${pet.name}${ready ? '; complete demo eligibility and approve listing' : '; leave eligibility for CAVD'}`)
  console.log(`Dry run: ${targets.length} targets (${targets.filter(target => !target.existing).length} new). No records changed. New pets have no photos.`)
  if (coverage) console.log('Coverage: all 600 type/size/age/temperament/activity combinations; synthetic care needs 1/5 and both household flags true.')
  process.exit(0)
}

// Use the demo CAVD session so normal RPCs, permissions and audit attribution apply.
let writer = admin
if (ready) {
  if (!process.env.VITE_SUPABASE_ANON_KEY || !process.env.DEMO_CAVD_PASSWORD)
    throw new Error('Missing public Supabase key or demo CAVD password in .env.local')
  writer = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, options)
  const { data, error } = await writer.auth.signInWithPassword({ email: 'cavd@demo.local', password: process.env.DEMO_CAVD_PASSWORD })
  if (error) throw new Error(`Demo CAVD sign-in failed: ${error.message}`)
  if (data.user.id !== cavdId) throw new Error('Unexpected CAVD demo account')
  const { data: profile, error: profileError } = await writer.from('profiles').select('role,is_active').eq('id', cavdId).single()
  if (profileError || profile.role !== 'cavd' || !profile.is_active) throw new Error('Active demo CAVD profile required')
}
const today = new Date().toISOString().slice(0, 10)
const demoNotes = 'Synthetic demo eligibility for matching and adoption workflow tests only. Not a real clinical or behavioral assessment.'
try {
  // New rows are inserted in batches. Existing pets retain their details and photos.
  for (const batch of chunks(targets.filter(target => !target.existing))) {
    const { data, error } = await writer.from('pets').insert(batch.map(({ pet }) => ({
      qr_slug: pet.slug, owner_id: null, created_by: cavdId, source: 'shelter', registry_status: 'approved',
      name: pet.name, species: pet.species, breed: pet.breed, sex: pet.sex, size: pet.size,
      birth_date: pet.birthDate, color: pet.color, about: pet.about, photo_url: null,
      sterilized: true, rabies_vaccinated: true, rabies_vaccinated_on: today,
      registry_note: 'Synthetic demo pet for matching and adoption workflow tests.',
      decided_by: cavdId, decided_at: new Date().toISOString()
    }))).select('id,qr_slug')
    if (error) throw error
    for (const row of data) targets.find(target => target.pet.slug === row.qr_slug).petId = row.id
    console.log(`Created ${data.length} demo pets without photos.`)
  }
  const existingTraitIds = new Set(allTraits.map(trait => trait.pet_id))
  for (const batch of chunks(targets.filter(target => !existingTraitIds.has(target.petId)))) {
    const { error } = await writer.from('pet_match_traits').insert(batch.map(({ pet, petId }) => ({ pet_id: petId, updated_by: cavdId, ...pet.traits })))
    if (error) throw error
  }
  if (ready) {
    // Bounded parallelism across distinct pets; each pet's health write precedes its review.
    let completed = 0
    for (const batch of chunks(targets, 8)) {
      const results = await Promise.allSettled(batch.map(async ({ petId, existing, checks }) => {
        let vaccinatedOn = existing?.rabies_vaccinated_on || today
        let validUntil = new Date(`${vaccinatedOn}T12:00:00Z`)
        validUntil.setUTCDate(validUntil.getUTCDate() + 365)
        if (!existing?.rabies_vaccinated || vaccinatedOn > today || validUntil.toISOString().slice(0, 10) < today) {
          vaccinatedOn = today
          validUntil = new Date(`${today}T12:00:00Z`)
          validUntil.setUTCDate(validUntil.getUTCDate() + 365)
        }
        let healthChanged = false
        if (existing && (!existing.sterilized || !existing.rabies_vaccinated || existing.rabies_vaccinated_on !== vaccinatedOn)) {
          const { data, error } = await writer.from('pets').update({ sterilized: true, rabies_vaccinated: true, rabies_vaccinated_on: vaccinatedOn })
            .eq('id', petId).is('owner_id', null).select('id').single()
          if (error || !data) throw error || new Error('Demo pet changed ownership; stopped')
          healthChanged = true
        }
        const alreadyReady = !healthChanged && checks?.availability === 'available' && checks.vaccination_status === 'current' &&
          checks.vaccination_valid_until >= today && checks.behavioral_clearance === 'cleared' && checks.verified_by && checks.verified_at
        if (!alreadyReady) {
          const { error } = await writer.rpc('save_pet_adoption_checks', {
            p_pet_id: petId, p_availability: 'available', p_vaccination_status: 'current',
            p_vaccination_valid_until: validUntil.toISOString().slice(0, 10), p_behavioral_clearance: 'cleared',
            p_notes: demoNotes, p_confirm: true
          })
          if (error) throw error
        }
        // Eligibility needs a Cleared latest visit. Earlier demo visits are left in place.
        const { data: latest, error: visitError } = await writer.from('visits').select('clearance_status').eq('pet_id', petId)
          .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (visitError) throw visitError
        if (latest?.clearance_status !== 'cleared') {
          const { error } = await writer.from('visits').insert({
            pet_id: petId, recorded_by: cavdId, clinic_name: 'CAVD Veterinary Clinic', visit_date: today,
            visit_type: 'checkup', reason: 'Synthetic demo clearance', summary: demoNotes, clearance_status: 'cleared'
          })
          if (error) throw error
        }
      }))
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
      completed += batch.length
      if (completed % 80 === 0 || completed === targets.length) console.log(`Demo readiness checked: ${completed}/${targets.length}`)
    }
  }
  for (const batch of chunks(targets.filter(target => !target.listings.length))) {
    const status = ready || !strictAdoption ? 'approved' : 'pending'
    const { error } = await writer.from('listings').insert(batch.map(({ petId }) => ({
      pet_id: petId, listed_by: cavdId, status, notes: 'Demo listing for testing only. This is not a real adoption offer.',
      decided_by: status === 'approved' ? cavdId : null, decided_at: status === 'approved' ? new Date().toISOString() : null
    })))
    if (error) throw error
  }
  if (ready) {
    const pending = targets.flatMap(target => target.listings.filter(listing => listing.status === 'pending'))
    for (const batch of chunks(pending)) {
      const { data, error } = await writer.from('listings').update({ status: 'approved', decided_by: cavdId, decided_at: new Date().toISOString() })
        .in('id', batch.map(listing => listing.id)).eq('status', 'pending').select('id')
      if (error || data.length !== batch.length) throw error || new Error('A pending demo listing changed while seeding')
    }
  }
  let visibleCount = 0
  for (const batch of chunks(targets)) {
    const { data, error } = await admin.from('public_listings').select('qr_slug').in('qr_slug', batch.map(target => target.pet.slug))
    if (error) throw error
    visibleCount += data.length
  }
  if (ready && visibleCount !== targets.length) throw new Error('Some demo pets are still excluded; review CAVD eligibility before retrying.')
  console.log(`${visibleCount} selected demo pets available. Sign in as adopter@demo.local and open Find My Match.`)

} finally {
  if (writer !== admin) await writer.auth.signOut({ scope: 'local' })
}
