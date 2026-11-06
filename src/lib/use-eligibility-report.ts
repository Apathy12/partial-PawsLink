import { useCallback, useEffect, useState } from 'react'
import { eligibilitySetupMessage, type EligibilityReport } from './eligibility'
import { explain, supabase } from './supabase'

export function useEligibilityReport() {
  const [report, setReport] = useState<EligibilityReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const rows: EligibilityReport[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: loadError } = await supabase.rpc('cavd_eligibility_report').range(offset, offset + 499)
        if (loadError) throw new Error(loadError.code === 'PGRST202' ? eligibilitySetupMessage : explain(loadError))
        const batch = (data || []) as EligibilityReport[]
        rows.push(...batch)
        if (batch.length < 500) break
      }
      setReport(rows); setError(null)
    } catch (cause) { setReport(null); setError(explain(cause as { message?: string })) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { report, error, loading, reload }
}
