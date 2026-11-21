import { useCallback, useEffect, useState } from 'react'
import { explain } from './supabase'

/** Rows per page on staff lists. Supabase returns at most 1,000 rows per request, so long lists must be paged. */
export const PAGE_SIZE = 10

type PageResult<T> = { data: T[] | null; count: number | null; error: { message?: string } | null }

/** Loads one page at a time. `fetchPage` must be memoized (useCallback) and request `{ count: 'exact' }`. */
export function usePagedRows<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    const from = page * PAGE_SIZE
    Promise.resolve(fetchPage(from, from + PAGE_SIZE - 1)).then(result => {
      if (!current) return
      if (result.error) { setError(explain(result.error)); setRows([]); setTotal(0); setLoading(false); return }
      const count = result.count || 0
      const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1)
      setTotal(count)
      // A decision can empty the last page; step back instead of showing an empty one.
      if (page > lastPage) { setPage(lastPage); return }
      setRows(result.data || [])
      setError(null)
      setLoading(false)
    }, (cause: { message?: string }) => {
      if (current) { setError(explain(cause)); setLoading(false) }
    })
    return () => { current = false }
  }, [fetchPage, page, version])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { rows, total, page, setPage, loading, error, reload }
}
