import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { explain, supabase } from '../lib/supabase'
import { uploadPetPhoto } from '../lib/photos'
import { VisitForm, VisitHistory } from '../lib/visits'
import { MatchTraitsEditor } from './match-traits-editor'
import { stageLabel } from '../lib/adoption-application'
import { fmtDate, petLine, qrUrl, sourceLabel } from '../lib/format'
import type { AdoptionRecord, Application, Listing, Pet, Profile, Visit, VisitCorrection } from '../lib/types'
import {
  Empty, Field, Photo, QrBlock, Shell, ToastHost, appPill, listingPill,
  registryPill, sourcePill, useToasts
} from '../ui'

type Counts = { regs: number; lists: number; apps: number; verifications: number }

export function OfficeShell({ children, counts }: { children: ReactNode; counts?: Counts }) {
  const { profile, signOut } = useAuth()
  return (
    <Shell
      who={profile?.name || ''}
      roleLabel="CAVD staff"
      extra={<span className="sub">The city is the system of record.</span>}
      onSignOut={() => void signOut()}
      nav={[
        { to: '/office', label: 'Desk', end: true },
        { to: '/office/registrations', label: 'Registrations', count: counts?.regs },
        { to: '/office/listings', label: 'Listings', count: counts?.lists },
        { to: '/office/applications', label: 'Applications', count: counts?.apps },
        { to: '/office/verifications', label: 'ID reviews', count: counts?.verifications },
        { to: '/office/intake', label: 'Shelter intake' },
        { to: '/office/registry', label: 'Full registry' },
        { to: '/office/accounts', label: 'Accounts' }
      ]}
    >{children}</Shell>
  )
}

function useCounts() {
  const [counts, setCounts] = useState<Counts>({ regs: 0, lists: 0, apps: 0, verifications: 0 })
  const refresh = useCallback(() => {
    Promise.all([
      supabase.from('pets').select('id', { count: 'exact', head: true }).eq('registry_status', 'pending'),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('verification_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('requested_role', 'vet')
    ]).then(([a, b, c, d]) => setCounts({
      regs: a.count || 0, lists: b.count || 0, apps: c.count || 0, verifications: d.count || 0
    }))
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { counts, refresh }
}

export function OfficeHome() {
  const { counts, refresh } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [regs, setRegs] = useState<Pet[]>([])
  const [lists, setLists] = useState<(Listing & { pet?: Pet })[]>([])
  const [apps, setApps] = useState<(Application & { listing?: Listing; pet?: Pet; adopter?: Profile })[]>([])

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('pets').select('*').eq('registry_status', 'pending').order('created_at')
    setRegs((p || []) as Pet[])
    const { data: l } = await supabase.from('listings').select('*').eq('status', 'pending').order('created_at')
    const listings = (l || []) as Listing[]
    const petIds = listings.map(x => x.pet_id)
    const { data: lp } = petIds.length
      ? await supabase.from('pets').select('*').in('id', petIds)
      : { data: [] as Pet[] }
    const petMap = new Map(((lp || []) as Pet[]).map(x => [x.id, x]))
    setLists(listings.map(x => ({ ...x, pet: petMap.get(x.pet_id) })))

    const { data: a } = await supabase.from('applications').select('*').eq('status', 'pending').order('created_at')
    const applications = (a || []) as Application[]
    const listingIds = applications.map(x => x.listing_id)
    const { data: al } = listingIds.length
      ? await supabase.from('listings').select('*').in('id', listingIds)
      : { data: [] as Listing[] }
    const listMap = new Map(((al || []) as Listing[]).map(x => [x.id, x]))
    const aPetIds = [...listMap.values()].map(x => x.pet_id)
    const { data: ap } = aPetIds.length
      ? await supabase.from('pets').select('*').in('id', aPetIds)
      : { data: [] as Pet[] }
    const aPetMap = new Map(((ap || []) as Pet[]).map(x => [x.id, x]))
    const adopterIds = applications.map(x => x.adopter_id)
    const { data: ad } = adopterIds.length
      ? await supabase.from('profiles').select('*').in('id', adopterIds)
      : { data: [] as Profile[] }
    const adMap = new Map(((ad || []) as Profile[]).map(x => [x.id, x]))
    setApps(applications.map(x => {
      const listing = listMap.get(x.listing_id)
      return { ...x, listing, pet: listing ? aPetMap.get(listing.pet_id) : undefined, adopter: adMap.get(x.adopter_id) }
    }))
    refresh()
  }, [refresh])

  useEffect(() => { void load() }, [load])

  async function approveReg(pet: Pet) {
    const { error } = await supabase.from('pets').update({
      registry_status: 'approved', decided_at: new Date().toISOString(), registry_note: null
    }).eq('id', pet.id)
    if (error) bad(explain(error)); else { ok(pet.name + ' verified. QR is now public.'); void load() }
  }
  async function rejectReg(pet: Pet) {
    const reason = window.prompt('Reason returned to the owner') || ''
    if (!reason.trim()) return
    const { error } = await supabase.from('pets').update({
      registry_status: 'rejected', registry_note: reason.trim(), decided_at: new Date().toISOString()
    }).eq('id', pet.id)
    if (error) bad(explain(error)); else { ok('Registration rejected.'); void load() }
  }
  async function decideListing(l: Listing, status: 'approved' | 'rejected') {
    const note = status === 'rejected' ? (window.prompt('Reason') || '') : null
    const { error } = await supabase.from('listings').update({
      status, decision_note: note, decided_at: new Date().toISOString()
    }).eq('id', l.id)
    if (error) bad(explain(error)); else { ok(status === 'approved' ? 'Listing published.' : 'Listing rejected.'); void load() }
  }

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>CAVD registry desk</h1>
        <p className="sub">Nothing is public, and no ownership moves, without a decision on this desk.</p>
      </div>
      <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
        <div className={'stat ' + (counts.regs ? 'warn' : '')}><div className="n">{counts.regs}</div><div className="l">Registrations to verify</div></div>
        <div className={'stat ' + (counts.lists ? 'warn' : '')}><div className="n">{counts.lists}</div><div className="l">Listings to approve</div></div>
        <div className={'stat ' + (counts.apps ? 'warn' : '')}><div className="n">{counts.apps}</div><div className="l">Applications to decide</div></div>
        <Link className={'stat stat-link ' + (counts.verifications ? 'warn' : '')} to="/office/verifications"><div className="n">{counts.verifications}</div><div className="l">IDs to review <span aria-hidden="true">→</span></div></Link>
      </div>

      <div className="card">
        <div className="card-head"><h2>Pending registrations</h2><span className="spacer" /><Link className="btn btn-sm btn-outline" to="/office/registrations">Open queue</Link></div>
        {regs.length === 0 ? <Empty>Nothing waiting.</Empty> : <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Pet</th><th>Status</th><th>Actions</th></tr></thead><tbody>{regs.map(p => (
          <tr key={p.id}>
            <td><div className="table-pet"><div className="avatar"><Photo url={p.photo_url} name={p.name} /></div>
              <div><Link className="pet-name" to={'/office/pets/' + p.id}>{p.name}</Link><div className="sub">{petLine(p)}</div></div>
            </div></td>
            <td>{registryPill(p.registry_status)}</td>
            <td className="btn-row">
              <button className="btn btn-sm btn-outline" type="button" onClick={() => void approveReg(p)}>Verify</button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void rejectReg(p)}>Reject</button>
            </td>
          </tr>
        ))}</tbody></table></div>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Pending listings</h2><span className="spacer" /><Link className="btn btn-sm btn-outline" to="/office/listings">Open queue</Link></div>
        <p className="sub">CAVD reviews owner requests before they appear on the adoption bridge.</p>
        {lists.length === 0 ? <Empty>Nothing waiting.</Empty> : <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Pet</th><th>Source</th><th>Notes</th><th>Actions</th></tr></thead><tbody>{lists.map(l => (
          <tr key={l.id}>
            <td><div className="table-pet"><div className="avatar"><Photo url={l.pet?.photo_url} name={l.pet?.name || 'Pet'} /></div><Link className="pet-name" to={'/office/pets/' + l.pet_id}>{l.pet?.name || l.pet_id}</Link></div></td>
            <td>{l.pet ? sourcePill(l.pet.source) : null}</td>
            <td className="table-notes">{l.notes}</td>
            <td className="btn-row">
              <button className="btn btn-sm btn-outline" type="button" onClick={() => void decideListing(l, 'approved')}>Approve</button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => void decideListing(l, 'rejected')}>Reject</button>
            </td>
          </tr>
        ))}</tbody></table></div>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Pending applications</h2><span className="spacer" /><Link className="btn btn-sm btn-outline" to="/office/applications">Open queue</Link></div>
        {apps.length === 0 ? <Empty>Nothing waiting.</Empty> : <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Applicant</th><th>Pet</th><th>Review stage</th><th>Actions</th></tr></thead><tbody>{apps.map(a => (
          <tr key={a.id}>
            <td>{a.adopter?.name}</td><td className="pet-name">{a.pet?.name}</td>
            <td>{stageLabel(a.review_stage, a.status)}</td>
            <td><Link className="btn btn-sm btn-outline" to={`/office/applications/${a.id}`}>Review application</Link></td>
          </tr>
        ))}</tbody></table></div>}
      </div>
    </OfficeShell>
  )
}

export function OfficeRegistrations() {
  const { counts, refresh } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [rows, setRows] = useState<Pet[]>([])
  const load = useCallback(() => {
    supabase.from('pets').select('*').eq('registry_status', 'pending').order('created_at')
      .then(({ data }) => { setRows((data || []) as Pet[]); refresh() })
  }, [refresh])
  useEffect(() => { load() }, [load])

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>Registration queue</h1>
        <p className="sub">Verification is what makes the QR public. Unverified pets cannot be listed and clinics cannot append visits.</p>
      </div>
      {rows.length === 0 ? <Empty>The queue is clear.</Empty> : <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Pet</th><th>Details</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(p => (
        <tr key={p.id}>
            <td><div className="table-pet"><div className="avatar"><Photo url={p.photo_url} name={p.name} /></div>
              <div><span className="pet-name">{p.name}</span><div className="sub">{petLine(p)}</div></div>
            </div></td>
            <td className="table-notes">
              <p>Colour: {p.color || '—'}</p><p>Markings: {p.markings || '—'}</p><p>{p.about || 'No notes.'}</p>
            </td>
            <td>{registryPill(p.registry_status)}</td>
            <td className="btn-row">
              <button className="btn btn-sm btn-outline" type="button" onClick={async () => {
                const { error } = await supabase.from('pets').update({
                  registry_status: 'approved', decided_at: new Date().toISOString()
                }).eq('id', p.id)
                if (error) bad(explain(error)); else { ok(p.name + ' verified.'); load() }
              }}>Verify and issue QR</button>
              <button className="btn btn-sm btn-danger" type="button" onClick={async () => {
                const reason = window.prompt('Reason') || ''
                if (!reason.trim()) return
                const { error } = await supabase.from('pets').update({
                  registry_status: 'rejected', registry_note: reason.trim(), decided_at: new Date().toISOString()
                }).eq('id', p.id)
                if (error) bad(explain(error)); else { ok('Rejected.'); load() }
              }}>Reject</button>
              <Link className="btn btn-sm btn-outline" to={'/office/pets/' + p.id}>Open</Link>
            </td>
        </tr>
      ))}</tbody></table></div>}
    </OfficeShell>
  )
}

export function OfficeListings() {
  const { counts, refresh } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [pending, setPending] = useState<(Listing & { pet?: Pet })[]>([])
  const [live, setLive] = useState<(Listing & { pet?: Pet })[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('listings').select('*').order('created_at', { ascending: false })
    const all = (data || []) as Listing[]
    const { data: pets } = await supabase.from('pets').select('*')
    const map = new Map(((pets || []) as Pet[]).map(p => [p.id, p]))
    const joined = all.map(l => ({ ...l, pet: map.get(l.pet_id) }))
    setPending(joined.filter(l => l.status === 'pending'))
    setLive(joined.filter(l => l.status === 'approved'))
    refresh()
  }, [refresh])
  useEffect(() => { void load() }, [load])

  async function decide(l: Listing, status: 'approved' | 'rejected' | 'closed') {
    const note = status === 'rejected' ? (window.prompt('Reason') || '') : null
    const { error } = await supabase.from('listings').update({
      status, decision_note: note, decided_at: new Date().toISOString()
    }).eq('id', l.id)
    if (error) bad(explain(error)); else { ok('Updated.'); void load() }
  }

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>Listing queue</h1>
        <p className="sub">CAVD reviews owner requests before publishing them. Veterinary visits are kept in the pet record when available.</p>
      </div>
      <div className="card">
        <h2>Waiting</h2>
        {pending.length === 0 ? <Empty>No listing requests waiting.</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Pet</th><th>Source</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {pending.map(l => (
                  <tr key={l.id}>
                    <td><div className="table-pet"><div className="avatar"><Photo url={l.pet?.photo_url} name={l.pet?.name || 'Pet'} /></div><Link to={'/office/pets/' + l.pet_id}>{l.pet?.name}</Link></div></td>
                    <td>{l.pet ? sourcePill(l.pet.source) : '—'}</td>
                    <td className="sub">{l.notes}</td>
                    <td className="btn-row">
                      <button className="btn btn-sm btn-outline" type="button" onClick={() => void decide(l, 'approved')}>Approve</button>
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => void decide(l, 'rejected')}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Live on the bridge</h2>
        {live.length === 0 ? <Empty>None published.</Empty> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Pet</th><th>Source</th><th>Approved</th><th></th></tr></thead>
              <tbody>
                {live.map(l => (
                  <tr key={l.id}>
                    <td><div className="table-pet"><div className="avatar"><Photo url={l.pet?.photo_url} name={l.pet?.name || 'Pet'} /></div>{l.pet?.name}</div></td>
                    <td>{l.pet ? sourceLabel(l.pet.source) : '—'}</td>
                    <td>{fmtDate(l.decided_at)}</td>
                    <td><button className="btn btn-sm btn-danger" type="button" onClick={() => void decide(l, 'closed')}>Close</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OfficeShell>
  )
}

export function CavdTransferControl({ application, onDone, onError }: {
  application: Application & { pet?: Pet; adopter?: Profile }
  onDone: () => void
  onError: (message: string) => void
}) {
  const [method, setMethod] = useState('')
  const [validationDate, setValidationDate] = useState(new Date().toISOString().slice(0, 10))
  const [validatedWith, setValidatedWith] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!method || !validatedWith.trim() || !note.trim()) return
    if (!window.confirm('This moves ownership to ' + (application.adopter?.name || 'the adopter') + ' and closes the listing.')) return
    setBusy(true)
    const { error } = await supabase.rpc('approve_application', {
      p_application_id: application.id,
      p_validation_method: method,
      p_validation_date: validationDate,
      p_validated_with: validatedWith.trim(),
      p_note: note.trim()
    })
    setBusy(false)
    if (error) onError(explain(error))
    else onDone()
  }

  return <details className="transfer-review"><summary>Validate and transfer</summary><form className="transfer-form" onSubmit={transfer}>
    <Field label="CAVD validation">
      <select value={method} onChange={e => setMethod(e.target.value)} required>
        <option value="">Choose method</option>
        <option value="owner_conversation">Spoke with owner / caretaker</option>
        <option value="cavd_visit">CAVD visit</option>
      </select>
    </Field>
    <Field label="Date validated"><input type="date" value={validationDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setValidationDate(e.target.value)} required /></Field>
    <Field label="Person contacted / present"><input value={validatedWith} onChange={e => setValidatedWith(e.target.value)} required placeholder="Owner, caretaker, or applicant" /></Field>
    <Field label="Outcome note"><textarea value={note} onChange={e => setNote(e.target.value)} required placeholder="What did CAVD confirm?" /></Field>
    <button className="btn btn-sm btn-outline" type="submit" disabled={busy || !application.pet}>{busy ? 'Transferring…' : 'Transfer ownership'}</button>
  </form></details>
}

export function OfficeApplications() {
  const { counts, refresh } = useCounts()
  const [rows, setRows] = useState<(Application & { pet?: Pet; listing?: Listing; adopter?: Profile; owner?: Profile })[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('applications').select('*').order('created_at', { ascending: false })
    const apps = (data || []) as Application[]
    const { data: listings } = await supabase.from('listings').select('*')
    const lmap = new Map(((listings || []) as Listing[]).map(l => [l.id, l]))
    const { data: pets } = await supabase.from('pets').select('*')
    const pmap = new Map(((pets || []) as Pet[]).map(p => [p.id, p]))
    const { data: people } = await supabase.from('profiles').select('*')
    const umap = new Map(((people || []) as Profile[]).map(u => [u.id, u]))
    setRows(apps.map(a => {
      const listing = lmap.get(a.listing_id)
      const pet = listing ? pmap.get(listing.pet_id) : undefined
      return { ...a, listing, pet, adopter: umap.get(a.adopter_id),
        owner: pet?.owner_id ? umap.get(pet.owner_id) : undefined }
    }))
    refresh()
  }, [refresh])
  useEffect(() => { void load() }, [load])

  const open = rows.filter(a => a.status === 'pending')
  const done = rows.filter(a => a.status !== 'pending')

  return (
    <OfficeShell counts={counts}>
      <div className="page-head">
        <h1>Adoption applications</h1>
        <p className="sub">Validate each request by speaking with the current owner or caretaker, or through a CAVD visit. Record what you confirmed before transferring ownership. Veterinary care remains in the pet record when available.</p>
      </div>
      {open.length === 0 ? <Empty>No open applications.</Empty> : <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Applicant</th><th>Pet</th><th>Review stage</th><th>Actions</th></tr></thead><tbody>{open.map(a => (
        <tr key={a.id}>
          <td>{a.adopter?.name}<div className="sub">{a.adopter?.contact || a.adopter?.id}</div></td>
          <td><div className="table-pet"><div className="avatar"><Photo url={a.pet?.photo_url} name={a.pet?.name || 'Pet'} /></div><div><span className="pet-name">{a.pet?.name}</span><div className="mono">{a.pet?.qr_slug}</div><div className="sub">{a.pet?.owner_id ? `Owner: ${a.owner?.name || 'Registered owner'}` : 'CAVD shelter'}</div>{a.owner?.contact ? <div className="sub">{a.owner.contact}</div> : null}</div></div></td>
          <td>{stageLabel(a.review_stage, a.status)}</td>
          <td>
            <Link className="btn btn-sm btn-outline" to={`/office/applications/${a.id}`}>Review application</Link>
          </td>
        </tr>
      ))}</tbody></table></div>}
      {done.length ? (
        <div className="card">
          <h2>Decision history</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Adopter</th><th>Pet</th><th>Status</th><th>Note</th><th>Details</th></tr></thead>
              <tbody>
                {done.map(a => (
                  <tr key={a.id}>
                    <td>{a.adopter?.name}</td>
                    <td><div className="table-pet"><div className="avatar"><Photo url={a.pet?.photo_url} name={a.pet?.name || 'Pet'} /></div>{a.pet?.name}</div></td>
                    <td>{appPill(a.status)}</td>
                    <td className="sub">{a.decision_note || '—'}</td>
                    <td><Link className="btn btn-sm btn-outline" to={`/office/applications/${a.id}`}>View application</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </OfficeShell>
  )
}

export function OfficeIntake() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const { counts } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [busy, setBusy] = useState(false)
  const [alsoList, setAlsoList] = useState(true)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!profile) return
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const file = f.get('photo') as File | null
      let photo_url: string | null = null
      if (file && file.size) photo_url = await uploadPetPhoto(profile.id, file)
      const { data, error } = await supabase.from('pets').insert({
        owner_id: null,
        created_by: profile.id,
        source: 'shelter',
        registry_status: 'approved',
        name: String(f.get('name') || '').trim(),
        species: f.get('species'),
        breed: String(f.get('breed') || '').trim() || null,
        sex: f.get('sex'),
        size: f.get('size'),
        birth_date: f.get('birth_date'),
        weight_kg: f.get('weight_kg') ? Number(f.get('weight_kg')) : null,
        color: String(f.get('color') || '').trim() || null,
        markings: String(f.get('markings') || '').trim() || null,
        about: String(f.get('about') || '').trim() || null,
        sterilized: f.get('sterilized') === 'on',
        rabies_vaccinated: f.get('rabies') === 'on',
        rabies_vaccinated_on: f.get('rabies') === 'on' ? (f.get('rabies_on') || null) : null,
        photo_url,
        decided_at: new Date().toISOString()
      }).select('*').single()
      if (error) throw error
      if (alsoList) {
        const { error: le } = await supabase.from('listings').insert({
          pet_id: data.id, listed_by: profile.id, status: 'approved',
          notes: String(f.get('about') || '').trim() || null,
          decided_by: profile.id, decided_at: new Date().toISOString()
        })
        if (le) throw le
      }
      ok(alsoList ? 'Intake verified and adoption listing published.' : 'Intake recorded and verified. QR issued.')
      nav('/office/pets/' + data.id)
    } catch (err) {
      bad(explain(err as { message?: string }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>Shelter intake</h1>
        <p className="sub">For animals already in city custody. CAVD creates the registry record and QR, and can publish its shelter listing.</p>
      </div>
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: '42rem' }}>
        <Field label="Name given at the shelter"><input name="name" required /></Field>
        <div className="grid grid-2">
          <Field label="Species">
            <select name="species"><option value="dog">Dog</option><option value="cat">Cat</option><option value="other">Other</option></select>
          </Field>
          <Field label="Sex">
            <select name="sex"><option value="male">Male</option><option value="female">Female</option></select>
          </Field>
          <Field label="Breed"><input name="breed" defaultValue="Aspin (mixed)" /></Field>
          <Field label="Size">
            <select name="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>
          </Field>
          <Field label="Estimated birth date"><input type="date" name="birth_date" required /></Field>
          <Field label="Weight (kg)"><input type="number" name="weight_kg" min="0.01" max="500" step="0.01" /></Field>
          <Field label="Colour"><input name="color" /></Field>
        </div>
        <Field label="Markings"><input name="markings" /></Field>
        <Field label="Notes / listing description"><textarea name="about" /></Field>
        <Field label="Photo"><input type="file" name="photo" accept="image/*" /></Field>
        <label className="field" style={{ fontWeight: 400 }}><input type="checkbox" name="sterilized" /> Already sterilised</label>
        <label className="field" style={{ fontWeight: 400 }}><input type="checkbox" name="rabies" /> Rabies vaccinated (public flag)</label>
        <Field label="Rabies date, if marked"><input type="date" name="rabies_on" /></Field>
        <label className="field" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={alsoList} onChange={e => setAlsoList(e.target.checked)} /> Publish an adoption listing after intake
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create record and issue QR'}</button>
      </form>
    </OfficeShell>
  )
}

export function OfficeRegistry() {
  const { counts } = useCounts()
  const [rows, setRows] = useState<Pet[]>([])
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    supabase.from('pets').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setRows((data || []) as Pet[]))
  }, [])
  const shown = rows.filter(p => {
    if (filter === 'pending') return p.registry_status === 'pending'
    if (filter === 'shelter') return p.source === 'shelter'
    if (filter === 'owner') return p.source === 'owner'
    return true
  })
  return (
    <OfficeShell counts={counts}>
      <div className="page-head">
        <h1>Full registry</h1>
        <p className="sub">Every pet, whether or not it is listed. This is the system of record.</p>
      </div>
      <div className="card">
        <form className="filters" onSubmit={e => e.preventDefault()}>
        <Field label="Show">
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">Everything</option>
            <option value="pending">Awaiting verification</option>
            <option value="shelter">Shelter custody</option>
            <option value="owner">Privately owned</option>
          </select>
        </Field>
        </form>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Pet</th><th>Tag</th><th>Status</th><th>Custody</th><th>Rabies</th></tr></thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id}>
                  <td><div className="table-pet"><div className="avatar"><Photo url={p.photo_url} name={p.name} /></div><div><Link to={'/office/pets/' + p.id}>{p.name}</Link><div className="sub">{petLine(p)}</div></div></div></td>
                  <td className="mono">{p.qr_slug}</td>
                  <td>{registryPill(p.registry_status)}</td>
                  <td>{sourceLabel(p.source)}</td>
                  <td>{p.rabies_vaccinated ? fmtDate(p.rabies_vaccinated_on) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </OfficeShell>
  )
}

export function OfficePet() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { counts } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [pet, setPet] = useState<Pet | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [corrections, setCorrections] = useState<VisitCorrection[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
  const [transfers, setTransfers] = useState<AdoptionRecord[]>([])
  const [photoBusy, setPhotoBusy] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    supabase.from('pets').select('*').eq('id', id).maybeSingle().then(({ data }) => setPet(data as Pet | null))
    supabase.from('visits').select('*').eq('pet_id', id).order('visit_date', { ascending: false })
      .then(async ({ data }) => {
        const records = (data || []) as Visit[]
        setVisits(records)
        if (!records.length) { setCorrections([]); return }
        const { data: auditRows } = await supabase.from('visit_corrections').select('*')
          .in('visit_id', records.map(v => v.id)).order('corrected_at', { ascending: false })
        setCorrections((auditRows || []) as VisitCorrection[])
      })
    supabase.from('listings').select('*').eq('pet_id', id).in('status', ['pending', 'approved']).maybeSingle()
      .then(({ data }) => setListing((data as Listing) ?? null))
    supabase.from('adoption_records').select('*').eq('pet_id', id).order('approved_at', { ascending: false })
      .then(({ data }) => setTransfers((data || []) as AdoptionRecord[]))
  }, [id])
  useEffect(() => { load() }, [load])

  async function saveFlags(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!pet) return
    const f = new FormData(e.currentTarget)
    const { error } = await supabase.from('pets').update({
      rabies_vaccinated: f.get('rabies') === 'on',
      rabies_vaccinated_on: f.get('rabies') === 'on' ? (f.get('rabies_on') || null) : null,
      sterilized: f.get('sterilized') === 'on'
    }).eq('id', pet.id)
    if (error) bad(explain(error)); else { ok('Public health flags saved.'); load() }
  }

  async function savePhoto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!pet || !profile) return
    const form = e.currentTarget
    const file = new FormData(form).get('photo') as File | null
    if (!file?.size) { bad('Choose a pet photo first.'); return }
    setPhotoBusy(true)
    try {
      const photo_url = await uploadPetPhoto(profile.id, file)
      const { error } = await supabase.from('pets').update({ photo_url }).eq('id', pet.id)
      if (error) throw error
      ok('Pet photo saved in the registry.')
      form.reset()
      load()
    } catch (cause) {
      bad(explain(cause as { message?: string; code?: string }))
    } finally { setPhotoBusy(false) }
  }

  async function correct(v: Visit) {
    const summary = window.prompt('Corrected summary', v.summary)
    if (summary == null) return
    const note = window.prompt('Audit note (required)')
    if (!note?.trim()) { bad('A correction needs an audit note.'); return }
    const { error } = await supabase.from('visits').update({
      summary: summary.trim(), correction_note: note.trim()
    }).eq('id', v.id)
    if (error) bad(explain(error)); else { ok('Correction saved.'); load() }
  }

  if (!pet) return <OfficeShell counts={counts}><Empty>No such record.</Empty></OfficeShell>

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="card">
        <div className="card-head">
          <div className="avatar registry-detail-photo"><Photo url={pet.photo_url} name={pet.name} /></div>
          <div>
            <h1>{pet.name}</h1>
            <div className="sub">{petLine(pet)}</div>
            <div className="pet-id">{pet.qr_slug}</div>
            <div className="btn-row" style={{ marginTop: '.4rem' }}>
              {registryPill(pet.registry_status)}
              {listing ? listingPill(listing.status) : <span className="pill">Not listed</span>}
              {sourcePill(pet.source)}
            </div>
          </div>
        </div>
      </div>
      <div className="split">
        <div>
          <div className="card">
            <h2>Visit history</h2>
            <VisitHistory visits={visits} petName={pet.name} canCorrect={v => void correct(v)} />
          </div>
          {corrections.length ? <div className="card">
            <h2>Visit correction audit</h2>
            <ul className="timeline">{corrections.map(c => <li key={c.id}>
              <strong>{fmtDate(c.corrected_at)}</strong> · {c.correction_note}
              <div className="sub">Before: {c.previous_record.summary}</div>
              <div className="sub">After: {c.corrected_record.summary}</div>
            </li>)}</ul>
          </div> : null}
          <div className="card">
            <h2>Adoption history</h2>
            {transfers.length ? <ul className="timeline">{transfers.map(transfer => <li key={transfer.id}>
              <strong>{fmtDate(transfer.approved_at)}</strong> · CAVD ownership transfer
              <div className="sub">Pet at transfer: {transfer.pet_snapshot.name} · {transfer.pet_snapshot.color || 'Color unrecorded'}</div>
              <div className="sub">Validation: {transfer.validation_method === 'cavd_visit' ? 'CAVD visit' : 'Owner / caretaker conversation'}</div>
              <div className="sub">{fmtDate(transfer.validation_date)} · With {transfer.validated_with}</div>
              <div className="sub">Last recorded pet visit before transfer: {transfer.last_visit_on ? fmtDate(transfer.last_visit_on) : 'None'}</div>
              <div className="locked">{transfer.decision_note || 'No decision note'}</div>
            </li>)}</ul> : <Empty>No adoption transfer recorded.</Empty>}
          </div>
        </div>
        <div>
          <MatchTraitsEditor petId={pet.id} onSaved={ok} />
          <div className="card">
            <h2>Pet record</h2>
            <dl className="kv">
              <dt>Registered owner</dt><dd>{pet.owner_id ? <Link to={`/office/accounts/${pet.owner_id}`}>View owner profile</Link> : 'CAVD shelter'}</dd>
              <dt>Birthday</dt><dd>{fmtDate(pet.birth_date)}</dd>
              <dt>Weight</dt><dd>{pet.weight_kg ? `${pet.weight_kg} kg` : 'Not recorded'}</dd>
              <dt>Color</dt><dd>{pet.color || 'Not recorded'}</dd>
              <dt>Markings</dt><dd>{pet.markings || 'Not recorded'}</dd>
              <dt>Breed</dt><dd>{pet.breed || 'Unknown'}</dd>
              <dt>Sterilized</dt><dd>{pet.sterilized ? 'Yes' : 'No'}</dd>
            </dl>
            <form onSubmit={savePhoto} className="record-photo-form">
              <Field label={pet.photo_url ? 'Replace pet photo' : 'Add a pet photo'}>
                <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
              </Field>
              <button className="btn btn-sm btn-outline" type="submit" disabled={photoBusy}>{photoBusy ? 'Uploading…' : 'Save photo'}</button>
            </form>
          </div>
          {pet.registry_status === 'approved' ? (
            <div className="card"><h2>QR</h2><QrBlock value={qrUrl(pet.qr_slug)} /></div>
          ) : null}
          <form className="card" onSubmit={saveFlags}>
            <h2>Public health flags</h2>
            <label className="field" style={{ fontWeight: 400 }}>
              <input type="checkbox" name="rabies" defaultChecked={pet.rabies_vaccinated} /> Rabies vaccinated
            </label>
            <Field label="Rabies date"><input type="date" name="rabies_on" defaultValue={pet.rabies_vaccinated_on || ''} /></Field>
            <label className="field" style={{ fontWeight: 400 }}>
              <input type="checkbox" name="sterilized" defaultChecked={pet.sterilized} /> Sterilised
            </label>
            <button className="btn btn-outline" type="submit">Save flags</button>
          </form>
        </div>
      </div>
      {profile ? <details className="card visit-entry-disclosure">
        <summary>Add a veterinary visit</summary>
        <VisitForm pet={pet} profile={profile} onSaved={load} embedded />
      </details> : null}
    </OfficeShell>
  )
}

export function OfficeAccounts() {
  const { counts } = useCounts()
  const { ok, bad, toasts } = useToasts()
  const [rows, setRows] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const load = useCallback(() => {
    supabase.from('profiles').select('*').order('name')
      .then(({ data, error }) => {
        setRows((data || []) as Profile[])
        setLoadError(error ? explain(error) : null)
      })
  }, [])
  useEffect(() => { load() }, [load])

  async function setActive(p: Profile, is_active: boolean) {
    const { error } = await supabase.from('profiles').update({ is_active }).eq('id', p.id)
    if (error) bad(explain(error)); else { ok(is_active ? 'Account enabled.' : 'Account disabled.'); load() }
  }

  const visibleRows = rows.filter(p =>
    `${p.name} ${p.contact || ''} ${p.clinic_name || ''} ${p.role}`
      .toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <OfficeShell counts={counts}>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>Accounts</h1>
        <p className="sub">Open an account to see its profile, submitted ID, and registered pets. Veterinarian access is managed in <Link to="/office/verifications">ID reviews</Link>.</p>
      </div>
      {loadError ? <div className="notice notice-bad" role="alert">Could not load accounts: {loadError}</div> : null}
      <div className="card">
        <label className="field office-account-search"><span className="lbl">Find an account</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, phone, clinic, or role" /></label>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Clinic</th><th>Active</th><th>Profile</th><th>Access</th></tr></thead>
            <tbody>
              {visibleRows.map(p => (
                <tr key={p.id}>
                  <td>{p.name}<div className="sub">{p.contact || p.id.slice(0, 8)}</div></td>
                  <td>{p.role}</td>
                  <td>{p.clinic_name || '—'}</td>
                  <td>{p.is_active ? 'Yes' : 'No'}</td>
                  <td><Link className="btn btn-sm btn-outline" to={`/office/accounts/${p.id}`}>View profile</Link></td>
                  <td className="btn-row">
                    {p.role === 'vet' && p.is_active ? (
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => void setActive(p, false)}>Disable</button>
                    ) : null}
                    {p.role === 'vet' && !p.is_active ? (
                      <button className="btn btn-sm btn-outline" type="button" onClick={() => void setActive(p, true)}>Enable</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loadError && visibleRows.length === 0 ? <Empty>{search ? 'No accounts match that search.' : 'No accounts found.'}</Empty> : null}
      </div>
    </OfficeShell>
  )
}
