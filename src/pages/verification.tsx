import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { explain, supabase } from '../lib/supabase'
import { capitalize, fmtDate } from '../lib/format'
import type { Profile, VerificationRequest } from '../lib/types'
import { Empty, Notice, ToastHost, useToasts } from '../ui'
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

export function OfficeVerification() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { ok, bad, toasts } = useToasts()

  const load = useCallback(async () => {
    const { data: requests, error: requestError } = await supabase.from('verification_requests')
      .select('*').order('created_at', { ascending: false })
    if (requestError) { setError(explain(requestError)); return }
    const list = (requests || []) as VerificationRequest[]
    const cleanup = await Promise.allSettled(list.filter(r => r.status === 'rejected' && r.id_path)
      .map(async row => {
        await deleteRejectedDocument(row)
        row.id_path = null
        row.prc_number = null
        row.clinic_name = null
      }))
    const ids = [...new Set(list.map(r => r.user_id))]
    const { data: people, error: peopleError } = ids.length
      ? await supabase.from('profiles').select('*').in('id', ids)
      : { data: [] as Profile[], error: null }
    if (peopleError) { setError(explain(peopleError)); return }
    const peopleById = new Map(((people || []) as Profile[]).map(p => [p.id, p]))
    setRows(list.map(r => ({ ...r, person: peopleById.get(r.user_id) })))
    const failed = cleanup.filter(result => result.status === 'rejected').length
    setError(failed ? `${failed} rejected ID file${failed === 1 ? '' : 's'} could not be deleted. Use Retry delete below.` : null)
  }, [])

  useEffect(() => { void load() }, [load])

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
      {rows.length ? <div className="card"><h2>Recorded IDs</h2><div className="table-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Result</th><th>Recorded</th><th>ID file</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id}><td><Link to={`/office/accounts/${row.user_id}`}>{row.person?.name || row.user_id.slice(0, 8)}</Link></td><td>{row.status === 'approved' && !row.reviewed_by ? 'Account activated' : capitalize(row.status)}</td><td>{fmtDate(row.reviewed_at || row.created_at)}</td><td>{row.status === 'rejected' ? row.id_path ? <button className="text-button" type="button" disabled={busyId === row.id} onClick={() => void retryDelete(row)}>{busyId === row.id ? 'Deleting…' : 'Retry delete'}</button> : 'Deleted' : 'Stored privately'}</td></tr>)}
      </tbody></table></div></div> : <Empty>No IDs have been recorded yet.</Empty>}
    </OfficeShell>
  )
}
