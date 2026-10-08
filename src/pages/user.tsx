import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { EducationHome } from './education'
import { explain, supabase } from '../lib/supabase'
import { useSavedListings } from '../lib/saved-listings'
import { stageLabel } from '../lib/adoption-application'
import { uploadPetPhoto } from '../lib/photos'
import { VisitHistory } from '../lib/visits'
import { ageLabel, fmtDate, petLine, qrUrl, sexLabel, sourceLabel, speciesLabel } from '../lib/format'
import type { AdoptionRecord, Application, Listing, Pet, PublicListing, Visit } from '../lib/types'
import {
  Empty, Field, ListingCard, Notice, Photo, Pill, QrBlock, SaveListingButton, Scanner, Shell,
  listingPill, registryPill, sourcePill, useToasts, ToastHost
} from '../ui'

export function UserShell({ children, showIdentity = false }: { children: ReactNode; showIdentity?: boolean }) {
  const { profile, signOut } = useAuth()
  return (
    <Shell
      who={profile?.name || ''}
      roleLabel="Owner / adopter"
      showIdentity={showIdentity}
      onSignOut={() => void signOut()}
      extra={<span className="sub">Register pets, request listings, and find a pet match. CAVD decides.</span>}
      nav={[
        { to: '/app', label: 'Home', end: true },
        { to: '/app/pets', label: 'My pets', end: true },
        { to: '/app/pets/new', label: 'Register a pet' },
        { to: '/app/bridge', label: 'Adoption' },
        { to: '/app/profile', label: 'My profile' },
        { to: '/app/scan', label: 'Scan QR' }
      ]}
    >{children}</Shell>
  )
}

export function UserHome() {
  return <UserShell><EducationHome /></UserShell>
}

export function UserPets() {
  const [pets, setPets] = useState<Pet[]>([])
  useEffect(() => {
    supabase.from('pets').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setPets((data || []) as Pet[]))
  }, [])
  return (
    <UserShell>
      <div className="page-head">
        <h1>My pets</h1>
        <p className="sub">Registration is the entry point. A pet is not adoptable and has no public QR until CAVD verifies it.</p>
      </div>
      <Link className="btn" to="/app/pets/new">Register a pet</Link>
      <div style={{ height: '1rem' }} />
      {pets.length === 0 ? <Empty>Nothing registered yet.</Empty> : (
        <div className="pet-list">
          {pets.map(p => (
            <article className="pet-list-row" key={p.id}>
              <div className="avatar"><Photo url={p.photo_url} name={p.name} /></div>
              <div className="pet-list-main">
                <h2 className="pet-name"><Link to={'/app/pets/' + p.id}>{p.name}</Link></h2>
                <div className="pet-meta">{petLine(p)}</div>
                <div>{registryPill(p.registry_status)}</div>
                <Link className="record-link" to={'/app/pets/' + p.id}>Open record</Link>
              </div>
              {p.registry_status === 'approved' ? <div className="qr-block"><QrBlock value={qrUrl(p.qr_slug)} /><div className="qr-caption">QR available</div></div> : null}
            </article>
          ))}
        </div>
      )}
    </UserShell>
  )
}

export function UserPetNew() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const { bad, ok, toasts } = useToasts()
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!profile) return
    const f = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const file = (f.get('photo') as File | null)
      let photo_url: string | null = null
      if (file && file.size) photo_url = await uploadPetPhoto(profile.id, file)
      const { data, error } = await supabase.from('pets').insert({
        owner_id: profile.id,
        created_by: profile.id,
        source: 'owner',
        registry_status: 'pending',
        name: String(f.get('name') || '').trim(),
        species: f.get('species'),
        breed: String(f.get('breed') || '').trim() || null,
        sex: f.get('sex'),
        size: f.get('size'),
        birth_date: f.get('birth_date'),
        color: String(f.get('color') || '').trim() || null,
        markings: String(f.get('markings') || '').trim() || null,
        about: String(f.get('about') || '').trim() || null,
        sterilized: f.get('sterilized') === 'on',
        photo_url
      }).select('id').single()
      if (error) throw error
      ok('Submitted. CAVD must verify the record before it can carry a public QR.')
      nav('/app/pets/' + data.id)
    } catch (err) {
      bad(explain(err as { message?: string }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <UserShell>
      <ToastHost toasts={toasts} />
      <div className="page-head">
        <h1>Register a pet</h1>
        <p className="sub">The record starts pending. It is not listed and the QR is not public until CAVD approves it.</p>
      </div>
      <form className="card form-panel" onSubmit={onSubmit}>
        <Field label="Name"><input name="name" required /></Field>
        <div className="grid grid-2">
          <Field label="Species">
            <select name="species"><option value="dog">Dog</option><option value="cat">Cat</option><option value="other">Other</option></select>
          </Field>
          <Field label="Sex">
            <select name="sex"><option value="male">Male</option><option value="female">Female</option></select>
          </Field>
          <Field label="Breed"><input name="breed" placeholder="Aspin (mixed)" /></Field>
          <Field label="Size">
            <select name="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>
          </Field>
          <Field label="Birth date"><input type="date" name="birth_date" required /></Field>
          <Field label="Colour"><input name="color" /></Field>
        </div>
        <Field label="Markings"><input name="markings" /></Field>
        <Field label="Pet description" hint="If you request an adoption listing, this description becomes public. Do not include phone numbers or addresses."><textarea name="about" /></Field>
        <Field label="Photo"><input type="file" name="photo" accept="image/*" /></Field>
        <label className="field" style={{ fontWeight: 400 }}>
          <input type="checkbox" name="sterilized" /> Already spayed or neutered
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for CAVD verification'}</button>
      </form>
    </UserShell>
  )
}

export function UserPetDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { ok, bad, toasts } = useToasts()
  const [pet, setPet] = useState<Pet | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
  const [transfers, setTransfers] = useState<AdoptionRecord[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    supabase.from('pets').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setPet(data as Pet | null))
    supabase.from('visits').select('*').eq('pet_id', id).order('visit_date', { ascending: false })
      .then(({ data }) => setVisits((data || []) as Visit[]))
    supabase.from('listings').select('*').eq('pet_id', id).in('status', ['pending', 'approved'])
      .maybeSingle().then(({ data }) => setListing((data as Listing) ?? null))
    supabase.from('adoption_records').select('*').eq('pet_id', id).order('approved_at', { ascending: false })
      .then(({ data }) => setTransfers((data || []) as AdoptionRecord[]))
  }, [id])

  useEffect(() => { load() }, [load])

  async function requestListing(e: FormEvent) {
    e.preventDefault()
    if (!pet || !profile) return
    setBusy(true)
    const { error } = await supabase.from('listings').insert({
      pet_id: pet.id, listed_by: profile.id, status: 'pending', notes: notes.trim() || null
    })
    setBusy(false)
    if (error) bad(explain(error))
    else { ok('Request sent. Hidden from adopters until CAVD approves it.'); load() }
  }

  if (!pet) {
    return <UserShell><Empty>No pet on this account matches that link.</Empty></UserShell>
  }

  return (
    <UserShell>
      <ToastHost toasts={toasts} />
      <div className="card">
        <div className="card-head">
          <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
          <div>
            <h1>{pet.name}</h1>
            <div className="sub">{petLine(pet)}</div>
            <div className="pet-id">{pet.qr_slug}</div>
            <div className="btn-row" style={{ marginTop: '.4rem' }}>
              {registryPill(pet.registry_status)}
              {listing ? listingPill(listing.status) : <Pill>Not listed</Pill>}
            </div>
          </div>
        </div>
        {pet.registry_status === 'rejected' ? <Notice kind="bad">Rejected: {pet.registry_note || 'See CAVD.'}</Notice> : null}
        {pet.registry_status === 'pending' ? <Notice kind="warn">Waiting for CAVD. A QR is issued after approval.</Notice> : null}
      </div>

      <div className="split">
        <div>
          <div className="card">
            <h2>Visit history</h2>
            <VisitHistory visits={visits} petName={pet.name} />
          </div>
          {transfers.length ? <div className="card"><h2>Adoption record</h2>
            <p className="sub">CAVD recorded {transfers.length} ownership transfer{transfers.length === 1 ? '' : 's'} for this pet. Its veterinary history remains with the pet.</p>
            <ul className="timeline">{transfers.map(transfer => <li key={transfer.id}>
              <strong>{fmtDate(transfer.approved_at)}</strong> · {transfer.pet_snapshot.name}
              <div className="sub">CAVD validation: {transfer.validation_method === 'cavd_visit' ? 'Visit' : 'Owner / caretaker conversation'}</div>
              <div className="sub">Validated {fmtDate(transfer.validation_date)}</div>
              <div className="sub">Last recorded pet visit before adoption: {transfer.last_visit_on ? fmtDate(transfer.last_visit_on) : 'None'}</div>
            </li>)}</ul>
          </div> : null}

          {pet.registry_status === 'approved' && !listing ? (
            <form className="card" onSubmit={requestListing}>
              <h2>Request an adoption listing</h2>
              <p className="sub">CAVD reviews this. Adopters cannot see it until approval.</p>
              <Field label="Why this pet needs a home" hint="CAVD reviews this before publishing it. Do not include contact details or a home address.">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} required />
              </Field>
              <button className="btn btn-outline" type="submit" disabled={busy}>Send request to CAVD</button>
            </form>
          ) : null}
          {listing?.status === 'pending' ? <Notice kind="warn">Listing request is with CAVD. It is not on the public bridge.</Notice> : null}
        </div>
        <div>
          {pet.registry_status === 'approved' ? (
            <div className="card">
              <h2>QR tag</h2>
              <QrBlock value={qrUrl(pet.qr_slug)} />
              <p className="sub" style={{ marginTop: '.6rem' }}>Opens the public profile only.</p>
            </div>
          ) : (
            <div className="card"><h2>QR tag</h2><p className="sub">Issued when CAVD verifies the record.</p></div>
          )}
          <div className="card">
            <h2>Public health flags</h2>
            <dl className="kv">
              <dt>Birthday</dt><dd>{fmtDate(pet.birth_date)}</dd>
              <dt>Weight</dt><dd>{pet.weight_kg ? `${pet.weight_kg} kg` : 'Not recorded'}</dd>
              <dt>Color</dt><dd>{pet.color || 'Not recorded'}</dd>
              <dt>Markings</dt><dd>{pet.markings || 'Not recorded'}</dd>
              <dt>Rabies</dt><dd>{pet.rabies_vaccinated ? `Yes, ${fmtDate(pet.rabies_vaccinated_on)}` : 'Not marked by CAVD'}</dd>
              <dt>Sterilised</dt><dd>{pet.sterilized ? 'Yes' : 'No'}</dd>
              <dt>Custody</dt><dd>{sourceLabel(pet.source)}</dd>
            </dl>
          </div>
        </div>
      </div>
    </UserShell>
  )
}

export function UserBridge() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const saved = useSavedListings(profileId)
  const [rows, setRows] = useState<PublicListing[]>([])
  const [myPets, setMyPets] = useState<Pet[]>([])
  const [myListings, setMyListings] = useState<Listing[]>([])
  const [myPetsLoading, setMyPetsLoading] = useState(true)
  const [myPetsError, setMyPetsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState('all')
  const [size, setSize] = useState('all')
  const [sex, setSex] = useState('all')
  const [age, setAge] = useState('all')

  useEffect(() => {
    supabase.from('public_listings').select('*').order('listed_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(explain(loadError))
        else setRows((data || []) as PublicListing[])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!profileId) return
    ;(async () => {
      const { data, error: petsError } = await supabase.from('pets').select('*').eq('owner_id', profileId).order('created_at', { ascending: false })
      if (petsError) {
        setMyPetsError(explain(petsError))
        setMyPetsLoading(false)
        return
      }
      const pets = (data || []) as Pet[]
      setMyPets(pets)
      if (pets.length) {
        const { data: activeListings } = await supabase.from('listings').select('*').in('pet_id', pets.map(pet => pet.id)).in('status', ['pending', 'approved'])
        setMyListings((activeListings || []) as Listing[])
      }
      setMyPetsLoading(false)
    })()
  }, [profileId])

  const shown = rows.filter(r => {
    if (species !== 'all' && r.species !== species) return false
    if (size !== 'all' && r.size !== size) return false
    if (sex !== 'all' && r.sex !== sex) return false
    if (age !== 'all') {
      const months = (Date.now() - new Date(r.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      const g = months < 12 ? 'baby' : months < 36 ? 'young' : months < 84 ? 'adult' : 'senior'
      if (g !== age) return false
    }
    if (q) {
      const hay = (r.name + ' ' + (r.breed || '') + ' ' + r.qr_slug).toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  return (
    <UserShell>
      <div className="page-head">
        <span className="step-label">One account for pet owners and adopters</span>
        <h1>Adoption</h1>
        <p className="sub">Browse available pets, use Find My Pet Match to begin an application, or request a new home for a pet you own.</p>
      </div>
      <div className="adoption-paths" aria-label="Adoption actions">
        <Link className="quicklink" to="/app/match"><span className="quicklink-icon" aria-hidden="true">★</span><span><strong>Find My Pet Match</strong><small>Answer 10 questions, see ranked pets, and apply from a match.</small></span><span aria-hidden="true">→</span></Link>
        <Link className="quicklink" to="/app/saved"><span className="quicklink-icon" aria-hidden="true">♥</span><span><strong>Saved pets</strong><small>Return to pets you want to consider.</small></span><span aria-hidden="true">→</span></Link>
        <a className="quicklink" href="#list-my-pet"><span className="quicklink-icon" aria-hidden="true">＋</span><span><strong>Find my pet a home</strong><small>Request a listing for a pet on your account.</small></span><span aria-hidden="true">→</span></a>
        <Link className="quicklink" to="/app/applications"><span className="quicklink-icon" aria-hidden="true">✉</span><span><strong>My applications</strong><small>See the status of pets you applied for.</small></span><span aria-hidden="true">→</span></Link>
      </div>
      <section id="open-for-adoption" className="adoption-section" aria-labelledby="adoption-open-title">
      <div className="page-head"><h2 id="adoption-open-title">Open for adoption</h2><p className="sub">Browse these CAVD-approved pets here. To start an application, use Find My Pet Match.</p></div>
      <form className="card filters" onSubmit={e => e.preventDefault()}>
        <Field label="Search"><input className="grow" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, breed or tag" /></Field>
        <Field label="Species">
          <select value={species} onChange={e => setSpecies(e.target.value)}>
            <option value="all">Any</option><option value="dog">Dogs</option><option value="cat">Cats</option>
          </select>
        </Field>
        <Field label="Size">
          <select value={size} onChange={e => setSize(e.target.value)}>
            <option value="all">Any</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </Field>
        <Field label="Sex">
          <select value={sex} onChange={e => setSex(e.target.value)}>
            <option value="all">Any</option><option value="male">Male</option><option value="female">Female</option>
          </select>
        </Field>
        <Field label="Age">
          <select value={age} onChange={e => setAge(e.target.value)}>
            <option value="all">Any</option>
            <option value="baby">Under 1 year</option>
            <option value="young">1–3 years</option>
            <option value="adult">3–7 years</option>
            <option value="senior">7 years and over</option>
          </select>
        </Field>
      </form>
      {loading ? <p className="sub" role="status">Loading approved pets…</p> : null}
      {error ? <Notice kind="bad">Could not load available pets: {error}</Notice> : null}
      {saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
      {!loading && !error ? <p className="sub">{shown.length} pet{shown.length === 1 ? '' : 's'} open for adoption.</p> : null}
      {!loading && !error && shown.length
        ? <div className="pet-grid">{shown.map(r => <ListingCard key={r.listing_id} row={r} href={'/app/listings/' + r.listing_id}
          actions={!saved.error ? <SaveListingButton saved={saved.ids?.has(r.listing_id) ?? false} disabled={!saved.ids}
            busy={saved.busyId === r.listing_id} onToggle={() => void saved.toggle(r.listing_id)} /> : undefined} />)}</div>
        : !loading && !error ? <Empty>{rows.length ? 'No approved pet matches these filters.' : 'No pets are open for adoption yet. CAVD publishes listings after review.'}</Empty> : null}
      </section>
      <section id="list-my-pet" className="adoption-section" aria-labelledby="adoption-list-title">
        <div className="page-head"><h2 id="adoption-list-title">Find my pet a home</h2><p className="sub">Select one of your registered pets to request an adoption listing. CAVD reviews it before the pet appears in matching.</p></div>
        {myPetsLoading ? <p className="sub" role="status">Loading your pets…</p> : null}
        {myPetsError ? <Notice kind="bad">Could not load your pets: {myPetsError}</Notice> : null}
        {!myPetsLoading && !myPetsError && myPets.length ? <div className="adoption-owned-list">{myPets.map(pet => {
          const listing = myListings.find(row => row.pet_id === pet.id)
          return <article className="adoption-owned-row" key={pet.id}>
            <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
            <div className="adoption-owned-copy"><h3>{pet.name}</h3><span className="sub">{pet.registry_status === 'approved' ? listing?.status === 'approved' ? 'Open for adoption' : listing?.status === 'pending' ? 'Adoption request under CAVD review' : 'Ready to request a listing' : 'Pet registration must be approved first'}</span></div>
            <Link className="btn btn-outline btn-sm" to={'/app/pets/' + pet.id}>{listing ? 'View pet and listing' : pet.registry_status === 'approved' ? 'Request listing' : 'View pet'}</Link>
          </article>
        })}</div> : !myPetsLoading && !myPetsError ? <div className="adoption-empty"><p>You have no registered pets yet.</p><Link to="/app/pets/new">Register a pet →</Link></div> : null}
      </section>
    </UserShell>
  )
}

export function UserListing() {
  const { id } = useParams()
  const { profile } = useAuth()
  const saved = useSavedListings(profile?.id)
  const [row, setRow] = useState<PublicListing | null>(null)
  const [mine, setMine] = useState<Application | null>(null)

  useEffect(() => {
    if (!id) return
    supabase.from('public_listings').select('*').eq('listing_id', id).maybeSingle()
      .then(({ data }) => setRow((data as PublicListing) ?? null))
    if (profile) {
      supabase.from('applications').select('*').eq('listing_id', id).eq('adopter_id', profile.id).maybeSingle()
        .then(({ data }) => setMine((data as Application) ?? null))
    }
  }, [id, profile])

  if (!row) {
    return <UserShell><Notice kind="warn">This listing is not public. It may still be pending CAVD approval.</Notice></UserShell>
  }

  return (
    <UserShell>
      <Link className="btn btn-sm btn-outline" to="/app/bridge">← All listings</Link>
      <div className="split" style={{ marginTop: '1rem' }}>
        <div className="record-main">
          <div className="pet-photo record-photo"><Photo url={row.photo_url} name={row.name} /></div>
          <div className="card-head">
            <div>
              <h1>{row.name}</h1>
              <div className="sub">{petLine(row)}</div>
              <div className="pet-id">{row.qr_slug}</div>
              <div className="btn-row" style={{ marginTop: '.4rem' }}>{sourcePill(row.source)}</div>
            </div>
          </div>
          <p>{row.listing_notes || row.about || ''}</p>
          <dl className="kv">
            <dt>Species</dt><dd>{speciesLabel(row.species)}</dd>
            <dt>Sex</dt><dd>{sexLabel(row.sex)}</dd>
            <dt>Age</dt><dd>{ageLabel(row.birth_date)}</dd>
            <dt>Listing status</dt><dd>Listing approved</dd>
            <dt>Rabies</dt><dd>{row.rabies_vaccinated ? `Vaccinated ${fmtDate(row.rabies_vaccinated_on)}` : 'Not marked'}</dd>
            <dt>Sterilised</dt><dd>{row.sterilized ? 'Yes' : 'No'}</dd>
          </dl>
          <Notice kind="info">Owner contact is withheld. CAVD handles the transfer.</Notice>
        </div>
        <div className="record-aside">
          <h2>Interested in this pet?</h2>
          <p className="sub">Browse this record here, then use Find My Pet Match to see ranked pets and begin an application from a match. CAVD reviews every application.</p>
          <div className="btn-row" style={{ marginBottom: '1rem' }}>
            {!saved.error ? <SaveListingButton saved={saved.ids?.has(row.listing_id) ?? false} disabled={!saved.ids}
              busy={saved.busyId === row.listing_id} onToggle={() => void saved.toggle(row.listing_id)} /> : null}
            <Link className="btn btn-sm btn-outline" to="/app/match">Find My Pet Match</Link>
          </div>
          {saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
          {mine ? (
            <div><p className="sub">Applied <time dateTime={mine.created_at}>{fmtDate(mine.created_at)}</time>.</p>
              <p><strong>{stageLabel(mine.review_stage, mine.status)}</strong></p>
              <Link className="btn btn-outline" to={`/app/applications/${mine.id}`}>View application</Link></div>
          ) : null}
        </div>
      </div>
    </UserShell>
  )
}

export function UserApplications() {
  const [rows, setRows] = useState<(Application & { listing?: PublicListing })[]>([])
  useEffect(() => {
    ;(async () => {
      const { data: apps } = await supabase.from('applications').select('*').order('created_at', { ascending: false })
      const list = (apps || []) as Application[]
      const { data: pubs } = await supabase.from('public_listings').select('*')
      const byId = new Map((pubs as PublicListing[] || []).map(p => [p.listing_id, p]))
      // Closed listings drop off public_listings; fall back to listing id only.
      setRows(list.map(a => ({ ...a, listing: byId.get(a.listing_id) })))
    })()
  }, [])

  return (
    <UserShell>
      <div className="page-head">
        <Link className="record-link" to="/app/bridge">← Adoption</Link>
        <h1>My applications</h1>
        <p className="sub">CAVD reviews every application. Neither the current owner nor a partner clinic can approve an adoption.</p>
      </div>
      {rows.length === 0 ? <Empty>No applications yet.</Empty> : (
        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Pet</th><th>Submitted</th><th>Review stage</th><th>Next step</th></tr></thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id}>
                    <td>{a.listing?.name || a.pet_name_snapshot || `Listing ${a.listing_id.slice(0, 8)}`}</td>
                    <td><time dateTime={a.created_at}>{fmtDate(a.created_at)}</time></td>
                    <td>{stageLabel(a.review_stage, a.status)}</td>
                    <td><Link className="btn btn-sm btn-outline" to={`/app/applications/${a.id}`}>View application</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </UserShell>
  )
}

export function UserScan() {
  const nav = useNavigate()
  return (
    <UserShell>
      <div className="page-head"><h1>Scan a QR</h1></div>
      <div className="card" style={{ maxWidth: '28rem' }}>
        <Scanner onSlug={(slug) => nav('/p/' + slug)} />
      </div>
    </UserShell>
  )
}
