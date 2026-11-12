import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile } from './types'

/** "Maria Santos (CAVD staff)" for an account id, so a recorded action can show who made it. Staff can read every profile. */
export function useNames(ids: (string | null | undefined)[]) {
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key) return
    let active = true
    supabase.from('profiles').select('id, name, role').in('id', key.split(',')).then(({ data }) => {
      const people = (data || []) as Pick<Profile, 'id' | 'name' | 'role'>[]
      if (active) setNames(Object.fromEntries(people.map(p => [p.id, `${p.name} (${p.role === 'cavd' ? 'CAVD staff' : 'owner / adopter'})`])))
    })
    return () => { active = false }
  }, [key])
  return (id: string | null | undefined) => (id && names[id]) || null
}
