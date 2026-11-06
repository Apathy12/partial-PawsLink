import { useEffect, useState } from 'react'
import { explain, supabase } from './supabase'
import type { Application } from './types'
import { eligibilitySetupMessage } from './eligibility'

/** Read existing requests; clicking Apply only opens the form. */
export function useListingApplications(adopterId: string | undefined) {
  const [applications, setApplications] = useState<Map<string, Application> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!adopterId) return
    let active = true
    setApplications(null)
    setError(null)
    Promise.all([
      supabase.from('applications').select('*').eq('adopter_id', adopterId),
      supabase.from('public_match_weights').select('version').single()
    ]).then(([result, setup]) => {
      if (!active) return
      if (setup.error) setError(eligibilitySetupMessage)
      else if (result.error) setError(explain(result.error))
      else setApplications(new Map(((result.data || []) as Application[]).map(row => [row.listing_id, row])))
    })
    return () => { active = false }
  }, [adopterId])
  return { applications, error }
}
