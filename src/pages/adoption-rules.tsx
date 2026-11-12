import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ADOPTION_RULES, eligibilityReasons, eligibilitySetupMessage, type AdoptionChecks, type EligibilityReport } from '../lib/eligibility'
import { capitalize, fmtDate } from '../lib/format'
import { CRITERION_LABELS, MATCH_CRITERIA, MATCH_WEIGHTS, validMatchWeights, type MatchWeights } from '../lib/matching'
import { explain, supabase } from '../lib/supabase'
import { useNames } from '../lib/staff'
import type { Pet, Visit } from '../lib/types'
import { Empty, Field, Notice, PetCode, Photo, Pill, clearancePill } from '../ui'
import { OfficeShell } from './office'

const blankChecks = { availability: 'hold', vaccination_status: 'incomplete', vaccination_valid_until: '', behavioral_clearance: 'pending', notes: '' } as const

export function PetEligibilityEditor({ pet, latestClearance, onSaved }: {
  pet: Pet; latestClearance: Visit['clearance_status'] | null; onSaved: (message: string) => void
}) {
  const { profile } = useAuth()
  const [saved, setSaved] = useState<AdoptionChecks | null>(null)
  const [draft, setDraft] = useState<Pick<AdoptionChecks, 'availability' | 'vaccination_status' | 'behavioral_clearance' | 'notes'> & { vaccination_valid_until: string }>({ ...blankChecks })
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const who = useNames([saved?.verified_by])

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase.from('pet_adoption_checks').select('*').eq('pet_id', pet.id).maybeSingle().then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) { setError(eligibilitySetupMessage); setReady(false) }
      else {
        const row = data as AdoptionChecks | null
        setSaved(row)
        setDraft(row ? { availability: row.availability, vaccination_status: row.vaccination_status,
          vaccination_valid_until: row.vaccination_valid_until || '', behavioral_clearance: row.behavioral_clearance, notes: row.notes } : { ...blankChecks })
        setReady(true); setError(null); setConfirmed(false)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [pet.id, pet.updated_at])

  function change<K extends keyof typeof draft>(key: K, value: typeof draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value })); setConfirmed(false)
  }
  const currentReasons = eligibilityReasons(pet, saved, latestClearance, today)
  const preview = eligibilityReasons(pet, { ...draft, verified_by: confirmed ? profile?.id : null,
    verified_at: confirmed ? new Date().toISOString() : null }, latestClearance, today)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!confirmed || busy || !ready) return
    setBusy(true); setError(null)
    const { data, error: saveError } = await supabase.rpc('save_pet_adoption_checks', {
      p_pet_id: pet.id, p_availability: draft.availability, p_vaccination_status: draft.vaccination_status,
      p_vaccination_valid_until: draft.vaccination_valid_until || null, p_behavioral_clearance: draft.behavioral_clearance,
      p_notes: draft.notes, p_confirm: confirmed
    })
    setBusy(false)
    if (saveError) setError(explain(saveError))
    else { setSaved(data as AdoptionChecks); setConfirmed(false); onSaved('CAVD adoption eligibility review saved.'); }
  }

  return <section className="card eligibility-editor" id="adoption-eligibility" aria-labelledby="pet-eligibility-title">
    <h2 id="pet-eligibility-title">Adoption eligibility</h2>
    <p className="sub">Every condition must pass before this pet is offered for adoption. <Link to="/office/adoption-rules">View adoption rules</Link>.</p>
    {loading ? <p role="status">Loading eligibility review…</p> : ready ? <p><Pill kind={currentReasons.length ? 'wait' : 'ok'}>{currentReasons.length ? 'Excluded' : 'Eligible'}</Pill> <span className="sub">Saved status · reviewed {fmtDate(saved?.verified_at)}{who(saved?.verified_by) ? ` by ${who(saved?.verified_by)}` : ''}</span></p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {!loading && ready ? <form onSubmit={event => void save(event)}>
      <Field label="Adoption availability" hint="Adopted is set by an ownership transfer. A new review keeps earlier transfer records.">
        <select value={draft.availability} onChange={event => change('availability', event.target.value as AdoptionChecks['availability'])}>
          {draft.availability === 'adopted' ? <option value="adopted" disabled>Adopted</option> : null}
          <option value="hold">Hold</option><option value="available">Available</option>
        </select>
      </Field>
      <Field label="Vaccination status"><select value={draft.vaccination_status} onChange={event => change('vaccination_status', event.target.value as AdoptionChecks['vaccination_status'])}><option value="incomplete">Incomplete / not verified</option><option value="current">Current</option></select></Field>
      <Field label="Vaccination valid through" hint="Use the date on the reviewed vaccination record. Public rabies flags must also be recorded."><input type="date" value={draft.vaccination_valid_until} required={draft.vaccination_status === 'current'} min={draft.vaccination_status === 'current' ? today : undefined} onChange={event => change('vaccination_valid_until', event.target.value)} /></Field>
      <Field label="Behavioral clearance"><select value={draft.behavioral_clearance} onChange={event => change('behavioral_clearance', event.target.value as AdoptionChecks['behavioral_clearance'])}><option value="pending">Pending assessment</option><option value="not_cleared">Not cleared</option><option value="cleared">Cleared</option></select></Field>
      <p className="sub">Spay / neuter: <strong>{pet.sterilized ? 'Completed' : 'Not recorded as completed'}</strong>. Update this in Public health flags. Health flag changes require a fresh eligibility review.</p>
      <p className="sub">Latest veterinary clearance: {clearancePill(latestClearance)} Set this on the pet’s veterinary visit.</p>
      <Field label="CAVD review notes"><textarea value={draft.notes} maxLength={3000} onChange={event => change('notes', event.target.value)} /></Field>
      <label className="check-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>I reviewed these recorded conditions, including any incomplete conditions.</span></label>
      <div className="eligibility-preview" aria-live="polite"><strong>Preview after saving: {preview.length ? 'Excluded' : 'Eligible'}</strong>{preview.length ? <ul>{preview.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>Every required condition passes. A CAVD-approved listing is still required.</p>}</div>
      <button className="btn btn-sm" type="submit" disabled={busy || !confirmed || draft.availability === 'adopted'}>{busy ? 'Saving review…' : 'Save eligibility review'}</button>
    </form> : null}
  </section>
}

export function OfficeAdoptionRules() {
  const [report, setReport] = useState<EligibilityReport[]>([])
  const [weights, setWeights] = useState<Record<string, string>>(Object.fromEntries(MATCH_CRITERIA.map(key => [key, String(MATCH_WEIGHTS[key])])) )
  const [version, setVersion] = useState(1)
  const [confirmedWeights, setConfirmedWeights] = useState(false)
  const [history, setHistory] = useState<{ version: number; updated_at: string; weights: MatchWeights }[]>([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      const rows: EligibilityReport[] = []
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.rpc('cavd_eligibility_report').range(offset, offset + 499)
        if (result.error) throw new Error(eligibilitySetupMessage)
        const batch = (result.data || []) as EligibilityReport[]
        rows.push(...batch)
        if (batch.length < 500) break
      }
      const [setting, revisions] = await Promise.all([
        supabase.from('public_match_weights').select('*').single(),
        supabase.from('match_weight_history').select('*').order('version', { ascending: false }).limit(5)
      ])
      if (!active) return
      if (setting.error || revisions.error || !validMatchWeights(setting.data?.weights)) throw new Error(eligibilitySetupMessage)
      setReport(rows); setVersion(setting.data.version); setConfirmedWeights(setting.data.cavd_confirmed)
      setWeights(Object.fromEntries(MATCH_CRITERIA.map(key => [key, String(setting.data.weights[key])])))
      setHistory(revisions.data || []); setReady(true); setLoading(false)
    })().catch(cause => { if (active) { setError(explain(cause)); setLoading(false) } })
    return () => { active = false }
  }, [])

  const parsedWeights = Object.fromEntries(MATCH_CRITERIA.map(key => [key, weights[key] === '' ? NaN : Number(weights[key])]))
  const valid = validMatchWeights(parsedWeights)
  const total = Object.values(parsedWeights).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  async function saveWeights(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true); setError(null); setNotice(null)
    const { data, error: saveError } = await supabase.rpc('set_match_weights', { p_weights: parsedWeights })
    setBusy(false)
    if (saveError) setError(explain(saveError))
    else { setVersion(data); setConfirmedWeights(true); setNotice('Compatibility weights saved. New applications use this version; earlier scores stay unchanged.'); setHistory(previous => [{ version: data, updated_at: new Date().toISOString(), weights: parsedWeights as MatchWeights }, ...previous].slice(0, 5)) }
  }
  const filtered = report.filter(row => (filter === 'all' || (filter === 'eligible' ? row.eligible : !row.eligible)) && `${row.name} ${row.qr_slug}`.toLowerCase().includes(query.trim().toLowerCase()))
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1))

  return <OfficeShell>
    <div className="page-head"><h1>Adoption rules</h1><p className="sub">Only pets that pass every condition below are offered for adoption and ranked in matching.</p><div className="btn-row"><a href="#eligibility-register">Pet eligibility</a><a href="#compatibility-weights">Compatibility weights</a></div></div>
    <section className="card"><h2>Required conditions</h2><div className="table-wrap"><table className="tbl"><thead><tr><th scope="col">Condition</th><th scope="col">Required record</th></tr></thead><tbody>{ADOPTION_RULES.map(([label, detail]) => <tr key={label}><th scope="row">{label}</th><td>{detail}</td></tr>)}</tbody></table></div><p className="sub">Missing, expired, on-hold, and unverified conditions exclude a pet. A high match score cannot override these checks.</p></section>
    {loading ? <p role="status">Loading adoption controls…</p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}{notice ? <Notice kind="ok">{notice}</Notice> : null}
    {!loading && ready ? <>
      <section className="card" id="eligibility-register"><h2>Pet eligibility</h2><p className="sub">{report.filter(row => row.eligible).length} eligible · {report.filter(row => !row.eligible).length} excluded · {report.length} registered pets</p>
        <form className="filters" onSubmit={event => event.preventDefault()}><Field label="Name or PET ID"><input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></Field><Field label="Show"><select value={filter} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">All pets</option><option value="eligible">Eligible only</option><option value="excluded">Excluded only</option></select></Field></form>
        {filtered.length ? <div className="table-wrap"><table className="tbl eligibility-register"><thead><tr><th scope="col">Pet</th><th scope="col">Availability</th><th scope="col">Clearance</th><th scope="col">Eligibility and reasons</th></tr></thead><tbody>{filtered.slice(activePage * 10, activePage * 10 + 10).map(row => <tr key={row.pet_id}><td><div className="table-pet"><div className="avatar"><Photo url={row.photo_url} name={row.name} /></div><div><strong>{row.name}</strong><PetCode code={row.qr_slug} compact /></div></div></td><td>{capitalize(row.availability)}</td><td>{clearancePill(row.latest_clearance)}</td><td><Pill kind={row.eligible ? 'ok' : 'wait'}>{row.eligible ? 'Eligible' : 'Excluded'}</Pill>{row.reasons.length ? <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p className="sub">All required conditions pass.</p>}</td></tr>)}</tbody></table></div> : <Empty>No pets match this view.</Empty>}
        {filtered.length > 10 ? <div className="btn-row pagination-row"><button className="btn btn-sm btn-outline" type="button" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</button><span aria-live="polite">Page {activePage + 1} of {Math.ceil(filtered.length / 10)}</span><button className="btn btn-sm btn-outline" type="button" disabled={(activePage + 1) * 10 >= filtered.length} onClick={() => setPage(activePage + 1)}>Next</button></div> : null}
      </section>
      <section className="card" id="compatibility-weights"><h2>Compatibility weights</h2><p className="sub">These Weighted Sum Model (WSM) weights score every match. Version {version} · {confirmedWeights ? 'Reviewed by CAVD' : 'Default equal weights; CAVD review pending'}. Weights must total 1.00. Saving creates a new version.</p>
        <form onSubmit={event => void saveWeights(event)}><div className="weight-fields">{MATCH_CRITERIA.map(key => <Field key={key} label={CRITERION_LABELS[key]}><input type="number" min="0" max="1" step="0.001" required value={weights[key]} onChange={event => setWeights(previous => ({ ...previous, [key]: event.target.value }))} /></Field>)}</div><p className={valid ? 'weight-total' : 'weight-total weight-total-invalid'} aria-live="polite">Total: {total.toFixed(3)} / 1.000 {valid ? '(100%)' : '— adjust the weights to total 1.00'}</p><button className="btn" disabled={!valid || busy}>{busy ? 'Saving weights…' : 'Confirm and save weights'}</button></form>
        <details className="weights-history"><summary>Recent weight versions</summary><ul>{history.map(row => <li key={row.version}>Version {row.version} · {fmtDate(row.updated_at)}<span className="sub"> · {MATCH_CRITERIA.map(key => `${CRITERION_LABELS[key]} ${(row.weights[key] * 100).toFixed(1)}%`).join(' · ')}</span></li>)}</ul></details>
      </section>
    </> : null}
  </OfficeShell>
}
