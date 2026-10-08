import { useCallback, useEffect, useState } from 'react'
import { explain, supabase } from './supabase'

export function useSavedListings(adopterId: string | undefined) {
  const [ids, setIds] = useState<Set<string> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!adopterId) return
    let current = true
    supabase.from('saved_listings').select('listing_id').eq('adopter_id', adopterId)
      .then(({ data, error: loadError }) => {
        if (!current) return
        if (loadError) setError(/Could not find the table 'public\.saved_listings'/i.test(loadError.message)
          ? 'Finish the project database setup to use saved pets.' : explain(loadError))
        else setIds(new Set((data || []).map(row => row.listing_id as string)))
      })
    return () => { current = false }
  }, [adopterId])

  const toggle = useCallback(async (listingId: string) => {
    if (!adopterId || !ids || busyId) return
    const wasSaved = ids.has(listingId)
    setBusyId(listingId)
    setError(null)
    const result = wasSaved
      ? await supabase.from('saved_listings').delete().eq('adopter_id', adopterId).eq('listing_id', listingId)
      : await supabase.from('saved_listings').insert({ adopter_id: adopterId, listing_id: listingId })
    if (result.error) setError(explain(result.error))
    else setIds(previous => {
      const next = new Set(previous)
      if (wasSaved) next.delete(listingId)
      else next.add(listingId)
      return next
    })
    setBusyId(null)
  }, [adopterId, ids, busyId])

  return { ids, busyId, error, toggle }
}
