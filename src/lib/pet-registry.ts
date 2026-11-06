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
