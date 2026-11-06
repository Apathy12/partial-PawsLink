import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/** The signed-in person's pet ids. Null until known, so apply actions stay hidden. */
export function useMyPetIds(profileId: string | undefined) {
  const [loaded, setLoaded] = useState<{ profileId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!profileId) return
    let active = true
    supabase.from('pets').select('id').eq('owner_id', profileId).then(({ data, error }) => {
      if (active && !error) setLoaded({ profileId, ids: new Set((data || []).map(pet => pet.id as string)) })
    })
    return () => { active = false }
  }, [profileId])
  if (!profileId) return new Set<string>()
  return loaded?.profileId === profileId ? loaded.ids : null
}
