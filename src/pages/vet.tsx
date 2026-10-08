import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { explain, supabase } from '../lib/supabase'
import { uploadPetPhoto } from '../lib/photos'
import { VisitForm, VisitHistory } from '../lib/visits'
import { petLine, qrUrl } from '../lib/format'
import type { Pet, Visit } from '../lib/types'
import { Empty, Field, Notice, Photo, QrBlock, Scanner, Shell, registryPill, useToasts, ToastHost } from '../ui'

function VetShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  return (
    <Shell
      who={profile?.name || ''}
      roleLabel="Partner veterinarian"
      extra={<span className="sub">{profile?.clinic_name || 'Private clinic'} · pet records and care history</span>}
      onSignOut={() => void signOut()}
      nav={[
        { to: '/vet', label: 'Lookup', end: true },
        { to: '/vet/scan', label: 'Scan QR' }
      ]}
    >{children}</Shell>
  )
}

export function VetHome() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Pet[]>([])
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    const term = q.trim()
    if (!term) { setRows([]); return }
    const { data, error } = await supabase.from('pets').select('*')
      .or(`name.ilike.%${term}%,qr_slug.ilike.%${term}%,breed.ilike.%${term}%`)
      .order('name')
    if (error) { setErr(explain(error)); setRows([]) }
    else { setErr(null); setRows((data || []) as Pet[]) }
  }

  return (
    <VetShell>
      <div className="page-head">
        <h1>Registry lookup</h1>
        <p className="sub">Search an approved pet by name or QR tag. Update pet details and record veterinary visits here.</p>
      </div>
      <form className="filters search-form" onSubmit={search}>
        <Field label="Name, breed or tag"><input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Bantay or k7n2p9qx" /></Field>
        <button className="btn" type="submit">Look up</button>
      </form>
      {err ? <Notice kind="bad">{err}</Notice> : null}
      {tried && rows.length === 0 ? <Empty>No approved pet matches. Unverified submissions are not visible to clinics.</Empty> : null}
      {rows.map(p => (
        <div className="queue-row" key={p.id}>
          <div className="avatar"><Photo url={p.photo_url} name={p.name} /></div>
          <div className="qmain">
            <div className="qtitle"><span className="pet-name">{p.name}</span> {registryPill(p.registry_status)}</div>
            <div className="sub">{petLine(p)} · <span className="mono">{p.qr_slug}</span></div>
          </div>
          <div className="qactions">
            <Link className="record-link" to={'/vet/pets/' + p.id}>View record</Link>
          </div>
        </div>
      ))}
    </VetShell>
  )
}

export function VetPet() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { ok, bad, toasts } = useToasts()
  const [pet, setPet] = useState<Pet | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    supabase.from('pets').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setPet(data as Pet | null))
    supabase.from('visits').select('*').eq('pet_id', id).order('visit_date', { ascending: false })
      .then(({ data }) => setVisits((data || []) as Visit[]))
  }, [id])

  useEffect(() => { load() }, [load])

  async function savePet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!pet || !profile) return
    const form = e.currentTarget
    const f = new FormData(form)
    setBusy(true)
    try {
      const file = f.get('photo') as File | null
      const photo_url = file?.size ? await uploadPetPhoto(profile.id, file) : pet.photo_url
      const { data, error } = await supabase.from('pets').update({
        name: String(f.get('name') || '').trim(),
        species: f.get('species'),
        breed: String(f.get('breed') || '').trim() || null,
        sex: f.get('sex'), size: f.get('size'),
        birth_date: f.get('birth_date'),
        weight_kg: f.get('weight_kg') ? Number(f.get('weight_kg')) : null,
        color: String(f.get('color') || '').trim() || null,
        markings: String(f.get('markings') || '').trim() || null,
        about: String(f.get('about') || '').trim() || null,
        sterilized: f.get('sterilized') === 'on', photo_url
      }).eq('id', pet.id).select('id').single()
      if (error || !data) throw error || new Error('Pet details were not updated.')
      ok('Pet details updated. The change is recorded for CAVD.')
      load()
    } catch (cause) {
      bad(explain(cause as { message?: string; code?: string }))
    } finally {
      setBusy(false)
    }
  }

  if (!pet) {
    return <VetShell><Notice kind="bad">No approved pet on this link. Pending registrations are hidden from clinics.</Notice></VetShell>
  }

  return (
    <VetShell>
      <ToastHost toasts={toasts} />
      <div className="card">
        <div className="card-head">
          <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
          <div>
            <h1>{pet.name}</h1>
            <div className="sub">{petLine(pet)}</div>
            <div className="pet-id">{pet.qr_slug}</div>
          </div>
        </div>
        <Notice kind="info">Clinic edits are recorded. CAVD keeps control of registration, public health flags, custody, listings, and adoption decisions.</Notice>
      </div>
      <form className="card form-panel" key={pet.id + pet.updated_at} onSubmit={savePet}>
        <h2>Edit pet details</h2>
        <div className="grid grid-2">
          <Field label="Name"><input name="name" required defaultValue={pet.name} /></Field>
          <Field label="Species"><select name="species" defaultValue={pet.species}><option value="dog">Dog</option><option value="cat">Cat</option><option value="other">Other</option></select></Field>
          <Field label="Breed"><input name="breed" defaultValue={pet.breed || ''} /></Field>
          <Field label="Sex"><select name="sex" defaultValue={pet.sex}><option value="male">Male</option><option value="female">Female</option></select></Field>
          <Field label="Size"><select name="size" defaultValue={pet.size}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></Field>
          <Field label="Birthday"><input type="date" name="birth_date" required max={new Date().toISOString().slice(0, 10)} defaultValue={pet.birth_date} /></Field>
          <Field label="Current weight (kg)"><input type="number" name="weight_kg" min="0.01" max="500" step="0.01" defaultValue={pet.weight_kg ?? ''} /></Field>
          <Field label="Color"><input name="color" defaultValue={pet.color || ''} /></Field>
          <Field label="Markings"><input name="markings" defaultValue={pet.markings || ''} /></Field>
          <Field label="New pet photo"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></Field>
        </div>
        <Field label="About this pet"><textarea name="about" defaultValue={pet.about || ''} /></Field>
        <label className="check-row"><input type="checkbox" name="sterilized" defaultChecked={pet.sterilized} /> Sterilized</label>
        <button className="btn btn-outline" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save pet details'}</button>
      </form>
      <div className="split">
        <div>
          <div className="card">
            <h2>Visit history</h2>
            <VisitHistory visits={visits} petName={pet.name} />
          </div>
        </div>
        <div className="card">
          <h2>QR</h2>
          <QrBlock value={qrUrl(pet.qr_slug)} />
        </div>
      </div>
      {profile ? <VisitForm pet={pet} profile={profile} onSaved={load} /> : null}
    </VetShell>
  )
}

export function VetScan() {
  const nav = useNavigate()
  return (
    <VetShell>
      <div className="page-head"><h1>Scan a tag</h1><p className="sub">Opens the clinic record if the pet is already verified.</p></div>
      <div className="card" style={{ maxWidth: '28rem' }}>
        <Scanner onSlug={async (slug) => {
          const { data } = await supabase.from('pets').select('id').eq('qr_slug', slug).maybeSingle()
          if (data) nav('/vet/pets/' + data.id)
          else nav('/p/' + slug)
        }} />
      </div>
    </VetShell>
  )
}
