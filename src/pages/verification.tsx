import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { explain, supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import { assessIdentityOcr, readIdentityDocument, type IdentityOcrAssessment } from '../lib/identity-ocr'
import type { Profile, VerificationRequest } from '../lib/types'
import { IdentityOcrReport } from '../identity-ocr-report'
import { Empty, Notice, Pill, ToastHost, useToasts } from '../ui'
import { OfficeShell } from './office'

type ReviewRow = VerificationRequest & { person?: Profile }

const idLabels: Record<VerificationRequest['id_type'], string> = {
  national_id: 'National ID',
  drivers_license: 'Driver’s license',
  passport: 'Passport',
  other_government_id: 'Government ID',
  prc_id: 'PRC professional ID'
}

export function OfficeVerification() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [documentLinks, setDocumentLinks] = useState<Record<string, string>>({})
  const [openedIds, setOpenedIds] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [scanBusyId, setScanBusyId] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<string | null>(null)
  const [scans, setScans] = useState<Record<string, { assessment: IdentityOcrAssessment | null; error: string | null }>>({})
  const { ok, bad, toasts } = useToasts()

  const deleteRejectedDocument = useCallback(async (row: VerificationRequest) => {
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
  }, [])

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
  }, [deleteRejectedDocument])

  useEffect(() => { void load() }, [load])

  async function viewDocument(row: ReviewRow) {
    if (!row.id_path) { bad('This request has no ID file. Ask the applicant to submit a new one.'); return }
    // Open the tab during the click so browsers do not block it after the URL request.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    setBusyId(row.id)
    const { data, error: linkError } = await supabase.storage.from('identity-documents')
      .createSignedUrl(row.id_path, 60)
    setBusyId(null)
    if (linkError || !data?.signedUrl) {
      tab?.close()
      bad(linkError ? explain(linkError) : 'The private ID could not be opened. Please try again.')
      return
    }
    setDocumentLinks(current => ({ ...current, [row.id]: data.signedUrl }))
    if (tab) {
      try {
        tab.location.replace(data.signedUrl)
        setOpenedIds(current => ({ ...current, [row.id]: true }))
      } catch {
        tab.close()
        bad('The ID tab could not open. Use the Open private ID link below, then approve.')
      }
    } else {
      bad('Your browser blocked the ID tab. Use the Open private ID link below, then approve.')
    }
  }

  async function scanDocument(row: ReviewRow) {
    if (!row.id_path) { bad('This request has no ID file.'); return }
    setScanBusyId(row.id)
    setScanProgress('Downloading private ID…')
    try {
      const { data, error: downloadError } = await supabase.storage.from('identity-documents').download(row.id_path)
      if (downloadError || !data) throw downloadError || new Error('The private ID could not be downloaded.')
      const extension = row.id_path.toLowerCase().split('.').pop()
      const type = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg'
      const file = new File([data], row.id_path.split('/').pop() || 'identity', { type })
      const read = await readIdentityDocument(file, setScanProgress)
      const assessment = assessIdentityOcr(read, {
        name: row.person?.name || '', idType: row.id_type, prcNumber: row.prc_number
      })
      setScans(current => ({ ...current, [row.id]: { assessment, error: null } }))
    } catch (scanError) {
      setScans(current => ({ ...current, [row.id]: {
        assessment: null, error: explain(scanError as { message?: string }, 'The ID text could not be read.')
      } }))
    } finally {
      setScanBusyId(null)
      setScanProgress(null)
    }
  }

  async function decide(row: ReviewRow, status: 'approved' | 'rejected') {
    const note = status === 'rejected' ? window.prompt('Why is this ID being rejected?')?.trim() : null
    if (status === 'rejected' && !note) return
    if (status === 'approved' && !window.confirm(`Approve ${row.person?.name || 'this applicant'} after checking the ${idLabels[row.id_type]}?`)) return
    setBusyId(row.id)
    const { data, error: reviewError } = await supabase.from('verification_requests')
      .update({ status, review_note: note })
      .eq('id', row.id).eq('status', 'pending').select('id').maybeSingle()
    if (reviewError) bad(explain(reviewError))
    else if (!data) bad('This request has already been reviewed. Refresh the queue.')
    else if (status === 'rejected') {
      try {
        await deleteRejectedDocument({ ...row, status })
        ok('ID rejected. The file and submitted ID details were deleted; the applicant can see the reason.')
      } catch (cleanupError) {
        bad(`ID rejected, but its file could not be deleted: ${explain(cleanupError as { message?: string })}. Use Retry delete below.`)
      }
      setDocumentLinks(current => { const next = { ...current }; delete next[row.id]; return next })
      void load()
    } else { ok('Identity approved. Access is now available.'); void load() }
    setBusyId(null)
  }

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

  const pending = rows.filter(row => row.status === 'pending')
  const reviewed = rows.filter(row => row.status !== 'pending')

  return (
    <OfficeShell>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <div className="step-label">CAVD · Private document review</div>
        <h1>Identity requests</h1>
        <p className="sub">Review PRC IDs before granting veterinary access. Owner and adopter IDs activate their accounts automatically after upload.</p>
      </div>
      {error ? <Notice kind="bad">{error}</Notice> : null}
      {pending.length === 0 ? <Empty>No IDs are waiting for review.</Empty> : (
        <div className="verification-queue">
          {pending.map(row => <article className="card review-card" key={row.id}>
            <div className="card-head"><div><h2><Link to={`/office/accounts/${row.user_id}`}>{row.person?.name || 'Applicant'}</Link></h2><p className="sub">Submitted {fmtDate(row.created_at)}</p></div><Pill kind="wait">Waiting for review</Pill></div>
            <dl className="kv">
              <dt>Requested access</dt><dd>{row.requested_role === 'vet' ? 'Veterinarian' : 'Pet owner / adopter'}</dd>
              <dt>Document</dt><dd>{idLabels[row.id_type]}</dd>
              {row.requested_role === 'vet' ? <><dt>Clinic</dt><dd>{row.clinic_name}</dd><dt>PRC number</dt><dd>{row.prc_number}</dd></> : null}
              <dt>Contact</dt><dd>{row.person?.contact || 'Not provided'}</dd>
            </dl>
            {row.requested_role === 'vet' ? <div className="btn-row">
              <button className="btn btn-outline" type="button" disabled={busyId === row.id} onClick={() => void viewDocument(row)}>{busyId === row.id ? 'Opening ID…' : 'View private ID'}</button>
              <button className="btn btn-outline" type="button" disabled={scanBusyId !== null} onClick={() => void scanDocument(row)}>{scanBusyId === row.id ? scanProgress || 'Checking text…' : 'Run OCR text check'}</button>
              {documentLinks[row.id] ? <a className="text-button" href={documentLinks[row.id]} target="_blank" rel="noreferrer" onClick={() => setOpenedIds(current => ({ ...current, [row.id]: true }))}>Open private ID again</a> : null}
              <button className="btn" type="button" disabled={busyId === row.id || !openedIds[row.id]} onClick={() => void decide(row, 'approved')}>Approve identity</button>
              <button className="btn btn-danger" type="button" disabled={busyId === row.id} onClick={() => void decide(row, 'rejected')}>Request a new ID</button>
            </div> : <Notice kind="warn">This owner ID is waiting under the old rules. Apply migration 0009 to activate the account automatically.</Notice>}
            {row.requested_role === 'vet' ? <>
              <IdentityOcrReport assessment={scans[row.id]?.assessment} error={scans[row.id]?.error} />
              <p className="hint">Compare the ID photo and details, then <a href="https://verification.prc.gov.ph/Verification" target="_blank" rel="noreferrer">check the veterinarian license in PRC’s official register</a> before approval. OCR is a reading aid, not a license check.</p>
            </> : null}
            {row.requested_role === 'vet' && !openedIds[row.id] ? <p className="hint">View the private ID first to enable approval.</p> : null}
          </article>)}
        </div>
      )}
      {reviewed.length ? <div className="card"><h2>Recorded IDs</h2><div className="table-wrap"><table className="tbl"><thead><tr><th>Applicant</th><th>Access</th><th>Result</th><th>Recorded</th><th>ID file</th></tr></thead><tbody>
        {reviewed.map(row => <tr key={row.id}><td><Link to={`/office/accounts/${row.user_id}`}>{row.person?.name || row.user_id.slice(0, 8)}</Link></td><td>{row.requested_role === 'vet' ? 'Veterinarian' : 'Pet owner / adopter'}</td><td>{row.requested_role === 'user' && row.status === 'approved' && !row.reviewed_by ? 'Account activated' : row.status}</td><td>{fmtDate(row.reviewed_at || row.created_at)}</td><td>{row.status === 'rejected' ? row.id_path ? <button className="text-button" type="button" disabled={busyId === row.id} onClick={() => void retryDelete(row)}>{busyId === row.id ? 'Deleting…' : 'Retry delete'}</button> : 'Deleted' : 'Stored privately'}</td></tr>)}
      </tbody></table></div></div> : null}
    </OfficeShell>
  )
}
