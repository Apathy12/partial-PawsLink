import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fmtDate, petLine, sourceLabel } from '../lib/format'
import { explain, supabase } from '../lib/supabase'
import type { Pet, Profile, VerificationRequest } from '../lib/types'
import { Empty, Notice, Photo, registryPill } from '../ui'
import { OfficeShell } from './office'

type AuthSummary = {
  email: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
}

const idLabels: Record<VerificationRequest['id_type'], string> = {
  national_id: 'National ID',
  drivers_license: 'Driver’s license',
  passport: 'Passport',
  other_government_id: 'Other government ID',
  prc_id: 'PRC professional ID'
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
      setAuthError(authResult.error
        ? 'Email details are unavailable. Ask the administrator to apply migration 0010.' : null)
      const otherErrors = [profileResult.error, requestResult.error, petResult.error]
        .filter(Boolean).map(item => explain(item))
      setError(otherErrors.length ? otherErrors.join(' ') : null)
      setLoading(false)
    }
    void load().catch(cause => {
      if (active) { setError(explain(cause as { message?: string })); setLoading(false) }
    })
    return () => { active = false }
  }, [id])

  async function viewDocument(request: VerificationRequest) {
    if (!request.id_path) return
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    setOpeningId(request.id)
    setDocumentError(null)
    try {
      const { data, error: signedError } = await supabase.storage.from('identity-documents')
        .createSignedUrl(request.id_path, 60)
      if (signedError || !data?.signedUrl) {
        tab?.close()
        setDocumentError(signedError ? explain(signedError) : 'The private ID could not be opened. Please try again.')
        return
      }
      setDocumentLinks(current => ({ ...current, [request.id]: data.signedUrl }))
      if (tab) {
        try { tab.location.replace(data.signedUrl) }
        catch { tab.close(); setDocumentError('Your browser blocked the ID tab. Use the private link below.') }
      } else {
        setDocumentError('Your browser blocked the ID tab. Use the private link below.')
      }
    } catch (cause) {
      tab?.close()
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
  const accountType = person.role === 'cavd' ? 'CAVD office' : person.registration_kind === 'vet' ? 'Veterinarian / clinic' : 'Pet owner / adopter'
  const currentAccess = person.registration_kind === 'vet' && person.role === 'user'
    ? 'Veterinary application awaiting approval' : person.role === 'cavd' ? 'CAVD staff'
      : person.role === 'vet' ? 'Veterinarian' : 'Pet owner / adopter'

  return <OfficeShell>
    <p className="sub"><Link to="/office/accounts">← Back to accounts</Link></p>
    <div className="page-head">
      <div className="step-label">CAVD · Registered account</div>
      <h1>{person.name}</h1>
      <p className="sub">Profile, submitted identification, and currently registered pets.</p>
    </div>
    {error ? <Notice kind="bad">Some account details could not be loaded. {error}</Notice> : null}
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
          <dt>Current access</dt><dd>{currentAccess}</dd>
          {person.clinic_name ? <><dt>Clinic</dt><dd>{person.clinic_name}</dd></> : null}
          <dt>Registered</dt><dd>{fmtDate(person.created_at)}</dd>
          <dt>Last sign-in</dt><dd>{authError ? 'Unavailable' : fmtDate(authSummary?.last_sign_in_at)}</dd>
          <dt>Account ID</dt><dd className="mono">{person.id}</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="account-ids-title">
        <h2 id="account-ids-title">Submitted IDs</h2>
        <p className="sub">Documents are private. Open them only when needed for CAVD work.</p>
        {documentError ? <Notice kind="bad">{documentError}</Notice> : null}
        {requests.length ? <div className="office-account-ids">{requests.map(request => <article className="office-account-id" key={request.id}>
          <h3>{idLabels[request.id_type]}</h3>
          <dl className="kv">
            <dt>Submitted</dt><dd>{fmtDate(request.created_at)}</dd>
            <dt>Status</dt><dd>{request.requested_role === 'user' && request.status === 'approved' && !request.reviewed_by ? 'Account activated' : request.status}</dd>
            {request.clinic_name ? <><dt>Clinic</dt><dd>{request.clinic_name}</dd></> : null}
            {request.prc_number ? <><dt>PRC number</dt><dd>{request.prc_number}</dd></> : null}
            {request.review_note ? <><dt>Decision note</dt><dd>{request.review_note}</dd></> : null}
          </dl>
          {request.id_path ? <div className="btn-row">
            <button type="button" className="btn btn-sm btn-outline" disabled={openingId === request.id} onClick={() => void viewDocument(request)}>{openingId === request.id ? 'Opening…' : 'View private ID'}</button>
            {documentLinks[request.id] ? <a href={documentLinks[request.id]} target="_blank" rel="noreferrer">Open ID again</a> : null}
          </div> : <p className="hint">{request.status === 'rejected' ? 'Rejected ID file was deleted.' : 'No ID file is available.'}</p>}
          {request.id_path && documentLinks[request.id] && !request.id_path.toLowerCase().endsWith('.pdf') ? <img className="office-account-id-preview" src={documentLinks[request.id]} alt={`${idLabels[request.id_type]} submitted by ${person.name}`} /> : null}
        </article>)}</div> : <Empty>{person.verification_exempt ? 'No ID submission is on file for this existing or exempt account.' : 'No ID has been submitted yet.'}</Empty>}
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
