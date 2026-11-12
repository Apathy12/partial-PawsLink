import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { EducationHome } from './education'
import { useInbox } from './inbox'
import { explain, supabase } from '../lib/supabase'
import { useSavedListings } from '../lib/saved-listings'
import { useListingApplications } from '../lib/listing-applications'
import { useMyPetIds } from '../lib/my-pets'
import { detailsRequested, ownerAnswered } from '../lib/pet-registry'
import { eligibilityReasons, type AdoptionChecks } from '../lib/eligibility'
import { applicationActionLabel, applicationPath, stageLabel } from '../lib/adoption-application'
import { uploadPetPhoto } from '../lib/photos'
import { VisitHistory } from '../lib/visits'
import { ageLabel, fmtDate, petLine, sexLabel, sourceLabel, speciesLabel } from '../lib/format'
import type { AdoptionRecord, Application, Listing, Pet, PublicListing, Visit } from '../lib/types'
import {
  ApplicationTracker, CardSkeletons, Empty, Field, ListingCard, Notice, Pagination, PetCode, Photo, Pill, SaveListingButton, Shell,
  listingPill, originBadge, registryPill, useToasts, ToastHost
} from '../ui'

export function UserShell({ children, showIdentity = false, inboxCount }: { children: ReactNode; showIdentity?: boolean; inboxCount?: number }) {
  const { profile, signOut } = useAuth()
  // The inbox page passes its own count, so the bell follows "Mark all as read".
  const ownCount = useInbox('user', inboxCount === undefined).newCount
  return (
    <Shell
      who={profile?.name || ''}
      roleLabel="Owner / adopter"
      showIdentity={showIdentity}
      inboxCount={inboxCount ?? ownCount}
      onSignOut={() => void signOut()}
      nav={[
        { to: '/app', label: 'Home', end: true },
        { to: '/app/pets', label: 'My pets', end: true },
        { to: '/app/pets/new', label: 'Register a pet' },
        { to: '/app/bridge', label: 'Adoption' },
        { to: '/app/profile', label: 'My profile' }
      ]}
      tabs={[
        { to: '/app', label: 'Home', end: true, icon: 'home' },
        { to: '/app/pets', label: 'My pets', icon: 'pets' },
        { to: '/app/bridge', label: 'Adopt', icon: 'adopt' },
        { to: '/app/applications', label: 'Applications', icon: 'apps' },
        { to: '/app/profile', label: 'Profile', icon: 'profile' }
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
        <p className="sub">CAVD approves each registration before the pet’s public record opens.</p>
      </div>
      <div className="btn-row">
        <Link className="btn" to="/app/pets/new">Register a pet</Link>
      </div>
      <div style={{ height: '1rem' }} />
      {pets.length === 0 ? <Empty>No pets registered yet.</Empty> : (
        <div className="pet-list">
          {pets.map(p => (
            <article className="pet-list-row" key={p.id}>
              <div className="avatar"><Photo url={p.photo_url} name={p.name} /></div>
              <div className="pet-list-main">
                <h2 className="pet-name"><Link to={'/app/pets/' + p.id}>{p.name}</Link></h2>
                <div className="pet-meta">{petLine(p)}</div>
                <PetCode code={p.qr_slug} compact />
                <div className="btn-row">{registryPill(p.registry_status)}{detailsRequested(p) ? <Pill kind="wait">CAVD needs details</Pill> : null}</div>
                <Link className="record-link" to={'/app/pets/' + p.id}>Open record</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </UserShell>
  )
}

// The same details serve a new registration and an owner's correction of a pending one.
function PetFields({ pet }: { pet?: Pet }) {
  return <>
    <Field label="Name"><input name="name" required defaultValue={pet?.name} /></Field>
    <div className="grid grid-2">
      <Field label="Species">
        <select name="species" required defaultValue={pet?.species ?? ''}><option value="" disabled>Choose…</option><option value="dog">Dog</option><option value="cat">Cat</option><option value="other">Other</option></select>
      </Field>
      <Field label="Sex">
        <select name="sex" required defaultValue={pet?.sex ?? ''}><option value="" disabled>Choose…</option><option value="male">Male</option><option value="female">Female</option></select>
      </Field>
      <Field label="Breed"><input name="breed" required placeholder="Aspin (mixed)" defaultValue={pet?.breed ?? ''} /></Field>
      <Field label="Size">
        <select name="size" required defaultValue={pet?.size ?? ''}><option value="" disabled>Choose…</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>
      </Field>
      <Field label="Birth date"><input type="date" name="birth_date" required defaultValue={pet?.birth_date} /></Field>
      <Field label="Color"><input name="color" required defaultValue={pet?.color ?? ''} /></Field>
    </div>
    <Field label="Markings" hint="Write None if there are no markings."><input name="markings" required defaultValue={pet?.markings ?? ''} /></Field>
    <Field label="Pet description" hint="If you request an adoption listing, this description becomes public. Do not include phone numbers or addresses."><textarea name="about" required defaultValue={pet?.about ?? ''} /></Field>
    <Field label={pet?.photo_url ? 'Replace photo' : 'Photo'} hint="A clear photo helps CAVD identify the pet."><input type="file" name="photo" accept="image/*" required={!pet?.photo_url} /></Field>
    <label className="field" style={{ fontWeight: 400 }}>
      <input type="checkbox" name="sterilized" defaultChecked={pet?.sterilized} /> Already spayed or neutered
    </label>
  </>
}

// The browser's required check passes blank spaces, so the text details are checked again here.
function readPetFields(f: FormData) {
  const text = (key: string) => String(f.get(key) || '').trim()
  if (['name', 'breed', 'color', 'markings', 'about'].some(key => !text(key))) return null
  return {
    name: text('name'), species: f.get('species'), breed: text('breed'), sex: f.get('sex'), size: f.get('size'),
    birth_date: f.get('birth_date'), color: text('color'), markings: text('markings'), about: text('about'),
    sterilized: f.get('sterilized') === 'on'
  }
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
    // The browser's required check can be bypassed for files.
    const file = f.get('photo') as File | null
    if (!file?.size) { bad('Add a photo of your pet.'); return }
    const details = readPetFields(f)
    if (!details) { bad('Fill in every pet detail.'); return }
    setBusy(true)
    try {
      const photo_url = await uploadPetPhoto(profile.id, file)
      const { data, error } = await supabase.from('pets').insert({
        owner_id: profile.id,
        created_by: profile.id,
        source: 'owner',
        registry_status: 'pending',
        ...details,
        photo_url
      }).select('id').single()
      if (error) throw error
      ok('Registration submitted. CAVD will review it.')
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
        <p className="sub">All details are required. CAVD reviews the registration before the pet’s public record opens.</p>
      </div>
      <form className="card form-panel" onSubmit={onSubmit}>
        <PetFields />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for CAVD approval'}</button>
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
  const [adoptionChecks, setAdoptionChecks] = useState<AdoptionChecks | null>(null)

  const load = useCallback(() => {
    if (!id) return
    supabase.from('pets').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setPet(data as Pet | null))
    supabase.from('visits').select('*').eq('pet_id', id).order('visit_date', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data }) => setVisits((data || []) as Visit[]))
    supabase.from('listings').select('*').eq('pet_id', id).in('status', ['pending', 'approved'])
      .maybeSingle().then(({ data }) => setListing((data as Listing) ?? null))
    supabase.from('adoption_records').select('*').eq('pet_id', id).order('approved_at', { ascending: false })
      .then(({ data }) => setTransfers((data || []) as AdoptionRecord[]))
    supabase.from('pet_adoption_checks').select('*').eq('pet_id', id).maybeSingle()
      .then(({ data }) => setAdoptionChecks(data as AdoptionChecks | null))
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
    else { ok('Listing request sent to CAVD.'); load() }
  }

  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!pet || !profile) return
    const f = new FormData(e.currentTarget)
    const file = f.get('photo') as File | null
    const details = readPetFields(f)
    if (!details || !(pet.photo_url || file?.size)) { bad('Fill in every pet detail and add a photo.'); return }
    setBusy(true)
    try {
      const photo_url = file?.size ? await uploadPetPhoto(profile.id, file) : pet.photo_url
      const { error } = await supabase.from('pets').update({ ...details, photo_url }).eq('id', pet.id)
      if (error) throw error
      ok('Details saved. CAVD will review the registration again.')
      load()
    } catch (err) {
      bad(explain(err as { message?: string }))
    } finally {
      setBusy(false)
    }
  }

  if (!pet) {
    return <UserShell><Empty>No pet on this account matches that link.</Empty></UserShell>
  }
  const requested = detailsRequested(pet)

  return (
    <UserShell>
      <ToastHost toasts={toasts} />
      <div className="card">
        <div className="card-head">
          <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
          <div>
            <h1>{pet.name}</h1>
            <div className="sub">{petLine(pet)}</div>
            <PetCode code={pet.qr_slug} />
            <div className="btn-row" style={{ marginTop: '.4rem' }}>
              {registryPill(pet.registry_status)}
              {listing ? listingPill(listing.status) : <Pill>Not listed</Pill>}
            </div>
          </div>
        </div>
        {pet.registry_status === 'rejected' ? <Notice kind="bad">Registration rejected: {pet.registry_note || 'Contact CAVD for the reason.'}</Notice> : null}
        {requested ? <Notice kind="warn"><strong>CAVD asks you to complete this registration:</strong> {pet.registry_note}
          {ownerAnswered(pet) ? <div>You updated the details on {fmtDate(pet.updated_at)}. CAVD will review them again.</div> : null}</Notice>
          : pet.registry_status === 'pending' ? <Notice kind="warn">Waiting for CAVD approval. The public record opens once approved.</Notice> : null}
      </div>
      {pet.registry_status === 'pending' ? <details className="card form-panel pet-correction" open={requested}>
        <summary>{requested ? 'Complete pet details' : 'Edit pet details'}</summary>
        <form key={pet.updated_at} onSubmit={saveDetails}>
          <PetFields pet={pet} />
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and send to CAVD'}</button>
        </form>
      </details> : null}

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
              <p className="sub">Adopters see the listing only after CAVD approves it.</p>
              <Field label="Why this pet needs a home" hint="This text becomes public. Do not include contact details or a home address.">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} required />
              </Field>
              <button className="btn btn-outline" type="submit" disabled={busy}>Send request to CAVD</button>
            </form>
          ) : null}
          {listing?.status === 'pending' ? <Notice kind="warn">Listing request sent. Waiting for CAVD approval.</Notice> : null}
          {listing?.status === 'approved' && eligibilityReasons(pet, adoptionChecks, visits[0]?.clearance_status).length ? <Notice kind="warn">The listing is approved, but the pet is hidden from adoption until CAVD completes its eligibility review.</Notice> : null}
        </div>
        <div>
          {pet.registry_status === 'approved' ? (
            <div className="card">
              <h2>Public pet record</h2>
              <p className="sub">The public record shows approved details only.</p>
              <Link className="btn btn-outline" to={'/p/' + pet.qr_slug}>Open public record</Link>
            </div>
          ) : (
            <div className="card"><h2>Public pet record</h2><p className="sub">Opens after CAVD approves this registration.</p></div>
          )}
          <div className="card">
            <h2>Pet details</h2>
            <dl className="kv">
              <dt>Birth date</dt><dd>{fmtDate(pet.birth_date)}</dd>
              <dt>Weight</dt><dd>{pet.weight_kg ? `${pet.weight_kg} kg` : 'Not recorded'}</dd>
              <dt>Color</dt><dd>{pet.color || 'Not recorded'}</dd>
              <dt>Markings</dt><dd>{pet.markings || 'Not recorded'}</dd>
              <dt>Rabies</dt><dd>{pet.rabies_vaccinated ? `Yes, ${fmtDate(pet.rabies_vaccinated_on)}` : 'Not marked by CAVD'}</dd>
              <dt>Sterilized</dt><dd>{pet.sterilized ? 'Yes' : 'No'}</dd>
              <dt>Custody</dt><dd>{sourceLabel(pet.source)}</dd>
            </dl>
          </div>
        </div>
      </div>
    </UserShell>
  )
}

const ADOPTION_PAGE_SIZE = 6

export function UserBridge() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const saved = useSavedListings(profileId)
  const requests = useListingApplications(profileId)
  const [rows, setRows] = useState<PublicListing[]>([])
  const [myPets, setMyPets] = useState<Pet[]>([])
  const [myListings, setMyListings] = useState<Listing[]>([])
  const [myAdoptionChecks, setMyAdoptionChecks] = useState<AdoptionChecks[]>([])
  const [myLatestVisits, setMyLatestVisits] = useState<Map<string, Visit['clearance_status']>>(new Map())
  const [myPetsLoading, setMyPetsLoading] = useState(true)
  const [myPetsError, setMyPetsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [species, setSpecies] = useState('all')
  const [size, setSize] = useState('all')
  const [sex, setSex] = useState('all')
  const [age, setAge] = useState('all')
  const [page, setPage] = useState(0)

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const listings: PublicListing[] = []
        for (let offset = 0; ; offset += 500) {
          const { data, error: loadError } = await supabase.from('public_listings').select('*')
            .order('listed_at', { ascending: false }).order('listing_id').range(offset, offset + 499)
          if (!current) return
          if (loadError) throw loadError
          listings.push(...(data || []) as PublicListing[])
          if (!data || data.length < 500) break
        }
        if (current) setRows(listings)
      } catch (cause) {
        if (current) setError(explain(cause as { message?: string }))
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => { current = false }
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
        const { data: checkRows } = await supabase.from('pet_adoption_checks').select('*').in('pet_id', pets.map(pet => pet.id))
        setMyAdoptionChecks((checkRows || []) as AdoptionChecks[])
        const { data: visitRows } = await supabase.from('visits').select('pet_id,clearance_status').in('pet_id', pets.map(pet => pet.id))
          .order('visit_date').order('created_at')
        // Rows arrive oldest first, so each pet's latest visit is the one that stays.
        setMyLatestVisits(new Map(((visitRows || []) as Pick<Visit, 'pet_id' | 'clearance_status'>[]).map(row => [row.pet_id, row.clearance_status])))
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
    return true
  })
  const activePage = Math.min(page, Math.max(0, Math.ceil(shown.length / ADOPTION_PAGE_SIZE) - 1))
  const visibleListings = shown.slice(activePage * ADOPTION_PAGE_SIZE, (activePage + 1) * ADOPTION_PAGE_SIZE)

  function changePage(next: number) {
    setPage(next)
    document.getElementById('open-for-adoption')?.scrollIntoView({ block: 'start' })
  }

  return (
    <UserShell>
      <div className="page-head">
        <h1>Adoption</h1>
        <p className="sub">Apply for a pet, find your best match, or request a new home for a pet you own.</p>
      </div>
      <div className="adoption-paths" aria-label="Adoption actions">
        <Link className="quicklink" to="/app/match"><span className="quicklink-icon" aria-hidden="true">★</span><span><strong>Find My Match</strong><small>Answer 10 questions, see ranked pets, and apply from a match.</small></span><span aria-hidden="true">→</span></Link>
        <Link className="quicklink" to="/app/saved"><span className="quicklink-icon" aria-hidden="true">♥</span><span><strong>Saved pets</strong><small>Return to pets you want to consider.</small></span><span aria-hidden="true">→</span></Link>
        <a className="quicklink" href="#list-my-pet"><span className="quicklink-icon" aria-hidden="true">＋</span><span><strong>Find my pet a home</strong><small>Request a listing for a pet on your account.</small></span><span aria-hidden="true">→</span></a>
        <Link className="quicklink" to="/app/applications"><span className="quicklink-icon" aria-hidden="true">✉</span><span><strong>My applications</strong><small>See the status of pets you applied for.</small></span><span aria-hidden="true">→</span></Link>
      </div>
      <section id="open-for-adoption" className="adoption-section" aria-labelledby="adoption-open-title">
      <div className="page-head"><h2 id="adoption-open-title">Open for adoption</h2><p className="sub">Choose a pet to see its details and apply.</p></div>
      <form className="card filters" onSubmit={e => e.preventDefault()}>
        <Field label="Species">
          <select value={species} onChange={e => { setSpecies(e.target.value); setPage(0) }}>
            <option value="all">Any species</option><option value="dog">Dogs</option><option value="cat">Cats</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Size">
          <select value={size} onChange={e => { setSize(e.target.value); setPage(0) }}>
            <option value="all">Any</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </Field>
        <Field label="Sex">
          <select value={sex} onChange={e => { setSex(e.target.value); setPage(0) }}>
            <option value="all">Any</option><option value="male">Male</option><option value="female">Female</option>
          </select>
        </Field>
        <Field label="Age">
          <select value={age} onChange={e => { setAge(e.target.value); setPage(0) }}>
            <option value="all">Any</option>
            <option value="baby">Under 1 year</option>
            <option value="young">1–3 years</option>
            <option value="adult">3–7 years</option>
            <option value="senior">7 years and over</option>
          </select>
        </Field>
      </form>
      {loading ? <CardSkeletons label="Loading approved pets…" /> : null}
      {error ? <Notice kind="bad">Could not load available pets: {error}</Notice> : null}
      {saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
      {requests.error ? <Notice kind="bad">{requests.error}</Notice> : null}
      {!loading && !error ? <p className="sub">{shown.length} pet{shown.length === 1 ? '' : 's'} open for adoption.</p> : null}
      {!loading && !error && shown.length
        ? <>
        <div className="pet-grid">{visibleListings.map(r => <ListingCard key={r.listing_id} row={r} href={'/app/listings/' + r.listing_id}
          actions={<>
            {myPets.some(pet => pet.id === r.pet_id) ? <Pill kind="owner">Your pet</Pill>
              : !requests.applications || myPetsLoading || Boolean(myPetsError)
              ? <button className="btn btn-sm" type="button" disabled>Applications unavailable</button>
              : <Link className="btn btn-sm" to={applicationPath(r.listing_id, requests.applications.get(r.listing_id))}>{applicationActionLabel(requests.applications.get(r.listing_id))}</Link>}
            {!saved.error ? <SaveListingButton saved={saved.ids?.has(r.listing_id) ?? false} disabled={!saved.ids}
              busy={saved.busyId === r.listing_id} onToggle={() => void saved.toggle(r.listing_id)} /> : null}
          </>} />)}</div>
        <Pagination label="Open for adoption" page={activePage} pageSize={ADOPTION_PAGE_SIZE} total={shown.length} onChange={changePage} />
        </>
        : !loading && !error ? <Empty>{rows.length ? 'No pets match these filters.' : 'No pets are open for adoption yet. CAVD publishes listings after review.'}</Empty> : null}
      </section>
      <section id="list-my-pet" className="adoption-section" aria-labelledby="adoption-list-title">
        <div className="page-head"><h2 id="adoption-list-title">Find my pet a home</h2><p className="sub">Request an adoption listing for one of your registered pets.</p></div>
        {myPetsLoading ? <p className="sub" role="status">Loading your pets…</p> : null}
        {myPetsError ? <Notice kind="bad">Could not load your pets: {myPetsError}</Notice> : null}
        {!myPetsLoading && !myPetsError && myPets.length ? <div className="adoption-owned-list">{myPets.map(pet => {
          const listing = myListings.find(row => row.pet_id === pet.id)
          return <article className="adoption-owned-row" key={pet.id}>
            <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
            <div className="adoption-owned-copy"><h3>{pet.name}</h3><span className="sub">{pet.registry_status === 'approved' ? listing?.status === 'approved' ? eligibilityReasons(pet, myAdoptionChecks.find(row => row.pet_id === pet.id) || null, myLatestVisits.get(pet.id)).length ? 'Hidden — CAVD eligibility review needed' : 'Open for adoption' : listing?.status === 'pending' ? 'Listing request waiting for CAVD' : 'Ready to request a listing' : 'Pet registration must be approved first'}</span></div>
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
  const requests = useListingApplications(profile?.id)
  const [row, setRow] = useState<PublicListing | null>(null)
  const myPetIds = useMyPetIds(profile?.id)
  const mine = requests.applications?.get(id || '')

  useEffect(() => {
    if (!id) return
    supabase.from('public_listings').select('*').eq('listing_id', id).maybeSingle()
      .then(({ data }) => setRow((data as PublicListing) ?? null))
  }, [id, profile])

  if (!row) {
    return <UserShell><Notice kind="warn">This listing is not public. It may still be pending CAVD approval.</Notice></UserShell>
  }
  const ownPet = myPetIds?.has(row.pet_id)

  return (
    <UserShell>
      <Link className="btn btn-sm btn-outline" to="/app/bridge">← Adoption</Link>
      <div className="split" style={{ marginTop: '1rem' }}>
        <div className="record-main">
          <div className="pet-photo record-photo"><Photo url={row.photo_url} name={row.name} /></div>
          <div className="card-head">
            <div>
              <h1>{row.name}</h1>
              <div className="sub">{petLine(row)}</div>
              <PetCode code={row.qr_slug} />
              <div className="btn-row" style={{ marginTop: '.4rem' }}>{originBadge(row.custody_source)}</div>
            </div>
          </div>
          <p>{row.listing_notes || row.about || ''}</p>
          <dl className="kv">
            <dt>Species</dt><dd>{speciesLabel(row.species)}</dd>
            <dt>Sex</dt><dd>{sexLabel(row.sex)}</dd>
            <dt>Age</dt><dd>{ageLabel(row.birth_date)}</dd>
            <dt>Rabies</dt><dd>{row.rabies_vaccinated ? `Vaccinated ${fmtDate(row.rabies_vaccinated_on)}` : 'Not marked'}</dd>
            <dt>Sterilized</dt><dd>{row.sterilized ? 'Yes' : 'No'}</dd>
          </dl>
          <Notice kind="info">Owner contact is withheld. CAVD handles the transfer.</Notice>
        </div>
        {ownPet ? <div className="record-aside">
          <h2>Your pet</h2>
          <Notice kind="info">This is your pet. You can manage its listing from <Link to={`/app/pets/${row.pet_id}`}>My pets</Link>.</Notice>
        </div> : <div className="record-aside">
          <h2>Interested in this pet?</h2>
          <p className="sub">Apply and CAVD will review your household and care plan.</p>
          <div className="btn-row" style={{ marginBottom: '1rem' }}>
            {requests.applications && myPetIds ? <Link className="btn" to={applicationPath(row.listing_id, mine)}>{applicationActionLabel(mine)}</Link> : <button className="btn" type="button" disabled>Loading application…</button>}
            {!saved.error ? <SaveListingButton saved={saved.ids?.has(row.listing_id) ?? false} disabled={!saved.ids}
              busy={saved.busyId === row.listing_id} onToggle={() => void saved.toggle(row.listing_id)} /> : null}
            <Link className="btn btn-sm btn-outline" to="/app/match">Find My Match</Link>
          </div>
          {saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
          {requests.error ? <Notice kind="bad">{requests.error}</Notice> : null}
          {mine ? (
            <div><p className="sub">Applied <time dateTime={mine.created_at}>{fmtDate(mine.created_at)}</time>.</p>
              <p><strong>{stageLabel(mine.review_stage, mine.status)}</strong></p>
              <ApplicationTracker stage={mine.review_stage} status={mine.status} />
            </div>
          ) : null}
        </div>}
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
        <p className="sub">Track each application’s review stage and next step.</p>
      </div>
      {rows.length === 0 ? <Empty>No applications yet.</Empty> : (
        <div className="card application-cards">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Pet</th><th>Submitted</th><th>Review stage</th><th>Next step</th></tr></thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id}>
                    <td>{a.listing?.name || a.pet_name_snapshot || `Listing ${a.listing_id.slice(0, 8)}`}</td>
                    <td><time dateTime={a.created_at}>{fmtDate(a.created_at)}</time></td>
                    <td><span className="stage-cell">{stageLabel(a.review_stage, a.status)}<ApplicationTracker stage={a.review_stage} status={a.status} compact /></span></td>
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
