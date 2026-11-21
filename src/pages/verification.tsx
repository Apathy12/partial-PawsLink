import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { explain, supabase } from '../lib/supabase'
import { capitalize, fmtDate } from '../lib/format'
import type { Profile, VerificationRequest } from '../lib/types'
import { Empty, Notice, Pagination, ToastHost, useToasts } from '../ui'
import { PAGE_SIZE, usePagedRows } from '../lib/paging'
import { OfficeShell } from './office'

type ReviewRow = VerificationRequest & { person?: Profile }

/** Deletes a rejected ID file, then clears its details from the request. */
export async function deleteRejectedDocument(row: VerificationRequest) {
  if (!row.id_path) return
  const { error: removeError } = await supabase.storage.from('identity-documents').remove([row.id_path])
  if (removeError) {
    const { data: latest } = await supabase.from('verification_requests')
      .select('status,id_path').eq('id', row.id).maybeSingle()
    if (latest?.status === 'rejected' && latest.id_path === null) return
    throw removeError
  }
  const { data, error: clearError } = await supabase.from('verification_requests')
    .update({ id_path: null, prc_number: null, clinic_name: null })
    .eq('id', row.id).eq('status', 'rejected').eq('id_path', row.id_path)
    .select('id').maybeSingle()
  if (clearError) throw clearError
  if (!data) {
    const { data: latest, error: readError } = await supabase.from('verification_requests')
      .select('status,id_path').eq('id', row.id).maybeSingle()
    if (readError || latest?.status !== 'rejected' || latest.id_path !== null) {
      throw readError || new Error('The rejected ID details could not be cleared.')
    }
  }
}

// One page of IDs, each with its account joined in the same request (no long list of user IDs in the address).
function reviewPage(from: number, to: number) {
  return supabase.from('verification_requests')
    .select('*, person:profiles!verification_requests_user_id_fkey(*)', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id').range(from, to)
    .then(result => ({ ...result, data: ((result.data || []) as (VerificationRequest & { person: Profile | null })[])
      .map((row): ReviewRow => ({ ...row, person: row.person || undefined })) }))
}

export function OfficeVerification() {
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { ok, bad, toasts } = useToasts()
  const reviews = usePagedRows<ReviewRow>(reviewPage)
  const { reload } = reviews

  // Rejected ID files are deleted on sight. Look for them across all pages, not just the one on screen.
  useEffect(() => {
    let current = true
    void (async () => {
      const { data, error: findError } = await supabase.from('verification_requests').select('*')
        .eq('status', 'rejected').not('id_path', 'is', null).limit(100)
      if (!current) return
      if (findError) { setCleanupError(explain(findError)); return }
      const list = (data || []) as VerificationRequest[]
      if (!list.length) return
      const cleanup = await Promise.allSettled(list.map(deleteRejectedDocument))
      if (!current) return
      const failed = cleanup.filter(result => result.status === 'rejected').length
      setCleanupError(failed ? `${failed} rejected ID file${failed === 1 ? '' : 's'} could not be deleted. Use Retry delete below.` : null)
      reload()
    })()
    return () => { current = false }
  }, [reload])
  const rows = reviews.rows
  const error = reviews.error || cleanupError
  const load = reload

  async function retryDelete(row: ReviewRow) {
    setBusyId(row.id)
    try {
      await deleteRejectedDocument(row)
      ok('Rejected ID file and submitted details deleted.')
    } catch (cleanupError) {
      bad(`Could not delete the rejected ID: ${explain(cleanupError as { message?: string })}`)
    } finally {
      setBusyId(null)
      void load()
    }
  }

  return (
    <OfficeShell>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>ID reviews</h1>
        <p className="sub">Accounts activate automatically after an ID is uploaded. Open an account to view its ID.</p>
      </div>
      {error ? <Notice kind="bad">{error}</Notice> : null}
      {reviews.loading ? <p role="status">Loading IDs…</p> : rows.length ? <div className="card"><h2>Recorded IDs</h2><div className="table-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Result</th><th>Recorded</th><th>ID file</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id}><td><Link to={`/office/accounts/${row.user_id}`}>{row.person?.name || row.user_id.slice(0, 8)}</Link></td><td>{row.status === 'approved' && !row.reviewed_by ? 'Account activated' : capitalize(row.status)}</td><td>{fmtDate(row.reviewed_at || row.created_at)}</td><td>{row.status === 'rejected' ? row.id_path ? <button className="text-button" type="button" disabled={busyId === row.id} onClick={() => void retryDelete(row)}>{busyId === row.id ? 'Deleting…' : 'Retry delete'}</button> : 'Deleted' : 'Stored privately'}</td></tr>)}
      </tbody></table></div><Pagination label="Recorded IDs" noun="ID" page={reviews.page} pageSize={PAGE_SIZE} total={reviews.total} onChange={reviews.setPage} /></div> : <Empty>No IDs have been recorded yet.</Empty>}
    </OfficeShell>
  )
}
