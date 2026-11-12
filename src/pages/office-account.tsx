import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { capitalize, fmtDate, petLine, sourceLabel } from '../lib/format'
import { explain, supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Pet, Profile, VerificationRequest } from '../lib/types'
import { Empty, Field, NoteAction, Notice, Photo, registryPill } from '../ui'
import { OfficeShell } from './office'
import { deleteRejectedDocument } from './verification'

type AuthSummary = {
  email: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
}

const idLabels: Record<VerificationRequest['id_type'], string> = {
  national_id: 'National ID',
  drivers_license: 'Driver’s license',
  passport: 'Passport',
  other_government_id: 'Other government ID'
}

export function OfficeAccount() {
  const { id } = useParams()
  const [person, setPerson] = useState<Profile | null>(null)
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null)
  const [requests, setRequests] = useState<VerificationRequest[]>([])
  const [pets, setPets] = useState<Pet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentLinks, setDocumentLinks] = useState<Record<string, string>>({})
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null)
  const me = useAuth().profile

  useEffect(() => {
    if (!id) return
    let active = true
    async function load() {
      const [profileResult, authResult, requestResult, petResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
        supabase.rpc('cavd_account_auth', { p_account_id: id }),
        supabase.from('verification_requests').select('*').eq('user_id', id).order('created_at', { ascending: false }),
        supabase.from('pets').select('*').eq('owner_id', id).order('created_at', { ascending: false })
      ])
      if (!active) return
      setPerson((profileResult.data as Profile | null) || null)
      setAuthSummary(((authResult.data as AuthSummary[] | null) || [])[0] || null)
      setRequests((requestResult.data || []) as VerificationRequest[])
      setPets((petResult.data || []) as Pet[])
      const signedDocuments = await Promise.all(((requestResult.data || []) as VerificationRequest[])
        .filter(request => request.id_path)
        .map(async request => {
          const { data } = await supabase.storage.from('identity-documents')
            .createSignedUrl(request.id_path!, 3600)
          return data?.signedUrl ? [request.id, data.signedUrl] as const : null
        }))
      if (!active) return
      setDocumentLinks(Object.fromEntries(signedDocuments.filter((entry): entry is readonly [string, string] => entry !== null)))
      setAuthError(authResult.error
        ? 'Email details are unavailable. Ask the system administrator to update the database.' : null)
      const otherErrors = [profileResult.error, requestResult.error, petResult.error]
        .filter(Boolean).map(item => explain(item))
      setError(otherErrors.length ? otherErrors.join(' ') : null)
      setLoading(false)
    }
    void load().catch(cause => {
      if (active) { setError(explain(cause as { message?: string })); setLoading(false) }
    })
    return () => { active = false }
  }, [id, version])

  async function change(update: Partial<Profile>, done: string) {
    const { error: saveError } = await supabase.from('profiles').update(update).eq('id', id)
    setSaved(saveError ? { ok: false, text: explain(saveError) } : { ok: true, text: done })
    if (!saveError) setVersion(current => current + 1)
  }

  async function rejectId(request: VerificationRequest, reason: string) {
    const { data, error: rejectError } = await supabase.from('verification_requests')
      .update({ status: 'rejected', review_note: reason }).eq('id', request.id).select('*').single()
    if (rejectError || !data) { setSaved({ ok: false, text: explain(rejectError) }); return }
    try {
      await deleteRejectedDocument(data as VerificationRequest)
      setSaved({ ok: true, text: 'ID rejected and its file deleted. The owner is asked to upload a new one.' })
    } catch (cause) {
      setSaved({ ok: false, text: `The ID was rejected, but its file is not deleted yet. Open ID reviews to retry. ${explain(cause as { message?: string })}` })
    }
    setVersion(current => current + 1)
  }

  async function viewDocument(request: VerificationRequest) {
    if (!request.id_path) return
    setOpeningId(request.id)
    setDocumentError(null)
    try {
      const { data, error: signedError } = await supabase.storage.from('identity-documents')
        .createSignedUrl(request.id_path, 3600)
      if (signedError || !data?.signedUrl) {
        setDocumentError(signedError ? explain(signedError) : 'The private ID could not be opened. Please try again.')
        return
      }
      setDocumentLinks(current => ({ ...current, [request.id]: data.signedUrl }))
    } catch (cause) {
      setDocumentError(explain(cause as { message?: string }))
    } finally {
      setOpeningId(null)
    }
  }

  if (!id) return <OfficeShell><Empty>Account not found.</Empty></OfficeShell>
  if (loading) return <OfficeShell><p className="sub" role="status">Loading account…</p></OfficeShell>
  if (!person) return <OfficeShell><p><Link to="/office/accounts">← Accounts</Link></p>{error ? <Notice kind="bad">{error}</Notice> : <Empty>Account not found.</Empty>}</OfficeShell>

  const avatarUrl = person.avatar_path
    ? supabase.storage.from('profile-photos').getPublicUrl(person.avatar_path).data.publicUrl : null
  const accountType = person.role === 'cavd' ? 'CAVD staff' : 'Pet owner / adopter'

  return <OfficeShell>
    <p className="sub"><Link to="/office/accounts">← Back to accounts</Link></p>
    <div className="page-head">
      <h1>{person.name}</h1>
    </div>
    {error ? <Notice kind="bad">Some account details could not be loaded. {error}</Notice> : null}
    {saved ? <div role="status"><Notice kind={saved.ok ? 'ok' : 'bad'}>{saved.text}</Notice></div> : null}
    <div className="office-account-grid">
      <section className="card" aria-labelledby="account-profile-title">
        <div className="office-account-heading"><div className="avatar office-account-avatar"><Photo url={avatarUrl} name={person.name} /></div><div><h2 id="account-profile-title">Profile</h2><p className="sub">{person.is_active ? 'Active account' : 'Disabled account'}</p></div></div>
        <dl className="kv">
          <dt>Full name</dt><dd>{person.name}</dd>
          <dt>Email</dt><dd>{authError || authSummary?.email || 'Not recorded'}</dd>
          <dt>Email confirmed</dt><dd>{authError ? 'Unavailable' : authSummary?.email_confirmed_at ? fmtDate(authSummary.email_confirmed_at) : 'No'}</dd>
          <dt>Phone</dt><dd>{person.contact || 'Not recorded'}</dd>
          <dt>Birthday</dt><dd>{person.birth_date ? fmtDate(person.birth_date) : 'Not recorded'}</dd>
          <dt>Location</dt><dd>{person.location || 'Not recorded'}</dd>
          <dt>Account type</dt><dd>{accountType}</dd>
          <dt>Registered</dt><dd>{fmtDate(person.created_at)}</dd>
          <dt>Last login</dt><dd>{authError ? 'Unavailable' : fmtDate(authSummary?.last_sign_in_at)}</dd>
          <dt>Account ID</dt><dd className="mono">{person.id}</dd>
        </dl>
        {me?.id === person.id ? <p className="hint">This is your own account. Another CAVD staff account must change its type or disable it.</p>
          : <form className="account-access" onSubmit={event => {
            event.preventDefault()
            void change({ role: new FormData(event.currentTarget).get('role') as Profile['role'] }, 'Account type saved.')
          }}>
            <h3>Account access</h3>
            <Field label="Account type" hint="CAVD staff can open the office and decide registrations, listings and applications.">
              <select name="role" key={person.role} defaultValue={person.role}>
                <option value="user">Pet owner / adopter</option><option value="cavd">CAVD staff</option>
              </select>
            </Field>
            <div className="btn-row">
              <button className="btn btn-sm btn-outline" type="submit">Save account type</button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void change({ is_active: !person.is_active }, person.is_active ? 'Account disabled.' : 'Account enabled.')}>{person.is_active ? 'Disable account' : 'Enable account'}</button>
            </div>
            <p className="hint">A disabled account cannot log in. Its pets and records stay.</p>
          </form>}
      </section>

      <section className="card" aria-labelledby="account-ids-title">
        <h2 id="account-ids-title">Submitted IDs</h2>
        <p className="sub">Documents are private. Open them only when needed for CAVD work.</p>
        {documentError ? <Notice kind="bad">{documentError}</Notice> : null}
        {requests.length ? <div className="office-account-ids">{requests.map(request => <article className="office-account-id" key={request.id}>
          <h3>{idLabels[request.id_type] ?? 'Earlier ID'}</h3>
          <dl className="kv">
            <dt>Submitted</dt><dd>{fmtDate(request.created_at)}</dd>
            <dt>Status</dt><dd>{request.requested_role === 'user' && request.status === 'approved' && !request.reviewed_by ? 'Account activated' : capitalize(request.status)}</dd>
            {request.review_note ? <><dt>Decision note</dt><dd>{request.review_note}</dd></> : null}
          </dl>
          {request.id_path ? <div className="btn-row">
            {!documentLinks[request.id] ? <button type="button" className="btn btn-sm btn-outline" disabled={openingId === request.id} onClick={() => void viewDocument(request)}>{openingId === request.id ? 'Loading ID…' : 'View submitted ID'}</button> : <a className="btn btn-sm btn-outline" href={documentLinks[request.id]} target="_blank" rel="noreferrer">Open ID in another tab</a>}
            {request.status === 'approved' ? <NoteAction label="Reject ID" danger prompt="Reason for rejecting" hint="The owner will see this and must upload a new ID. The file is deleted." submit="Reject ID" onSend={reason => rejectId(request, reason)} /> : null}
          </div> : <p className="hint">{request.status === 'rejected' ? 'Rejected ID file was deleted.' : 'No ID file is available.'}</p>}
          {request.id_path && documentLinks[request.id] ? request.id_path.toLowerCase().endsWith('.pdf')
            ? <iframe className="office-account-id-preview office-account-id-pdf" src={documentLinks[request.id]} title={`${idLabels[request.id_type]} submitted by ${person.name}`} />
            : <img className="office-account-id-preview" src={documentLinks[request.id]} alt={`${idLabels[request.id_type]} submitted by ${person.name}`} /> : null}
        </article>)}</div> : <Empty>{person.verification_exempt ? 'No ID on file. This account did not need to upload one.' : 'No ID has been submitted yet.'}</Empty>}
      </section>
    </div>

    <section className="card" aria-labelledby="account-pets-title">
      <div className="card-head"><div><h2 id="account-pets-title">Registered pets</h2><p className="sub">{pets.length} pet{pets.length === 1 ? '' : 's'} currently linked to this account.</p></div></div>
      {pets.length ? <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Pet</th><th>Registry status</th><th>Source</th><th>Health</th><th>Record</th></tr></thead>
        <tbody>{pets.map(pet => <tr key={pet.id}>
          <td><div className="table-pet"><div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div><div><strong>{pet.name}</strong><div className="sub">{petLine(pet)}</div><div className="sub">Born {fmtDate(pet.birth_date)} · {pet.color || 'Color not recorded'}</div></div></div></td>
          <td>{registryPill(pet.registry_status)}</td>
          <td>{sourceLabel(pet.source)}</td>
          <td>{pet.rabies_vaccinated ? `Rabies recorded ${fmtDate(pet.rabies_vaccinated_on)}` : 'Rabies not recorded'}</td>
          <td><Link className="btn btn-sm btn-outline" to={`/office/pets/${pet.id}`}>Full pet record</Link></td>
        </tr>)}</tbody>
      </table></div> : <Empty>No pets are currently registered to this account.</Empty>}
    </section>
  </OfficeShell>
}
