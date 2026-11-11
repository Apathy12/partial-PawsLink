import { supabase } from './supabase'
import type { Pet } from './types'

export const REGISTRY_PAGE_SIZE = 10

export function fetchRegistryPage({ page, search, status, source }: {
  page: number
  search: string
  status?: Pet['registry_status']
  source?: Pet['source']
}) {
  let request = supabase.from('pets').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id')
  if (status) request = request.eq('registry_status', status)
  if (source) request = request.eq('source', source)
  const term = search.trim()
  if (term) {
    // Quote PostgREST filter values so punctuation stays part of the search.
    // Escape LIKE wildcards to search literal pet names and codes.
    const pattern = JSON.stringify(`%${term.replace(/[\\%_]/g, '\\$&')}%`)
    request = request.or(['name', 'qr_slug', 'breed', 'species']
      .map(column => `${column}.ilike.${pattern}`).join(','))
  }
  const start = page * REGISTRY_PAGE_SIZE
  return request.range(start, start + REGISTRY_PAGE_SIZE - 1)
}

type Registration = Pick<Pet, 'registry_status' | 'registry_note' | 'decided_at' | 'updated_at'>

/** CAVD asked the owner to complete a pending registration: it stays pending and carries CAVD's note. */
export function detailsRequested(pet: Registration) {
  return pet.registry_status === 'pending' && Boolean(pet.registry_note)
}

/** The owner saved the record after that request, so it is ready for CAVD to check again. */
export function ownerAnswered(pet: Registration) {
  return detailsRequested(pet) && Boolean(pet.decided_at) && Date.parse(pet.updated_at) > Date.parse(pet.decided_at!)
}

/** Details an owner registration should carry before CAVD approves it. */
export function missingPetDetails(pet: Pick<Pet, 'breed' | 'color' | 'markings' | 'about' | 'photo_url'>) {
  return ([['breed', pet.breed], ['colour', pet.color], ['markings', pet.markings], ['description', pet.about], ['photo', pet.photo_url]] as const)
    .filter(([, value]) => !value?.trim()).map(([label]) => label)
}

/** Postgres reads 'now' as the statement's time, the same value the trigger stamps on updated_at. */
export function requestPetDetails(petId: string, note: string) {
  return supabase.from('pets').update({ registry_note: note, decided_at: 'now' }).eq('id', petId)
}
