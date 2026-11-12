import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  APPLICATION_SECTIONS, fieldApplies, normalizedAnswers, stageLabel, validateAnswers,
  todayInputDate, needsApplicationForm, type ApplicationAnswers, type ReviewStage
} from '../lib/adoption-application'
import { fmtDate, petLine } from '../lib/format'
import { preferenceAnswerRows } from '../lib/matching'
import { useMyPetIds } from '../lib/my-pets'
import { useNames } from '../lib/staff'
import { explain, supabase } from '../lib/supabase'
import type { AdopterPreferences, Application, ApplicationEvent, Listing, Pet, Profile, PublicListing } from '../lib/types'
import { ApplicationTracker, Empty, Field, Notice, Photo, discoveryPill } from '../ui'
import { UserShell } from './user'
import { CavdTransferControl, OfficeShell } from './office'
import { eligibilitySetupMessage } from '../lib/eligibility'
import { useEligibilityReport } from '../lib/use-eligibility-report'

function ApplicationAnswersView({ answers }: { answers: ApplicationAnswers }) {
  return <div className="application-sections">{APPLICATION_SECTIONS.map(section => <section className="card" key={section.title}>
    <h2>{section.title}</h2>
    <dl className="application-answers">{section.fields.map(field => <div key={field.key}>
      <dt>{field.label}</dt><dd>{answers[field.key] || 'Not recorded'}</dd>
    </div>)}</dl>
  </section>)}</div>
}

function PreferenceAnswers({ answers }: { answers: NonNullable<Application['preference_snapshot_json']> }) {
  return <dl className="application-answers">{preferenceAnswerRows(answers).map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>)}</dl>
}

function StampedPreferences({ application }: { application: Application }) {
  if (application.discovery_path !== 'match' || !application.preference_snapshot_json) return null
  return <section className="card"><h2>Find My Match answers at submission</h2>
    <p className="sub">Stamped {fmtDate(application.preference_snapshot_at)}. Later changes to preferences do not change this record.</p>
    <PreferenceAnswers answers={application.preference_snapshot_json} />
  </section>
}

function ApplicationSource({ application }: { application: Application }) {
  return <p className="sub">Found through: {application.application_source === 'direct' ? 'Direct adoption request' : application.application_source === 'match' ? 'Find My Match' : application.application_source === 'explore' ? 'Explore pets' : 'Earlier application'}
    {application.compatibility_score !== null && application.compatibility_score !== undefined
      ? ` · Match score at submission: ${Number(application.compatibility_score).toFixed(1)}%` : ''}.
    {application.compatibility_weights_version ? ` Weight version ${application.compatibility_weights_version}.` : ''}</p>
}

function ApplicationHistory({ events, who }: { events: ApplicationEvent[]; who?: (id: string | null) => string | null }) {
  if (!events.length) return null
  return <section className="card"><h2>Application history</h2>
    <ol>{events.map(event => <li key={event.id}>
      <strong>{stageLabel(event.new_stage || 'pending_review', event.new_status)}</strong>
      <span className="sub"> · {new Date(event.created_at).toLocaleString()}{who?.(event.actor_id) ? ` · by ${who(event.actor_id)}` : ''}</span>
      {event.remarks ? <p className="application-preline">{event.remarks}</p> : null}
    </li>)}</ol>
  </section>
}

function readApplicationDraft(key: string): { answers: ApplicationAnswers; declared: boolean } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null') as { answers?: unknown; declared?: unknown } | null
    const raw = saved?.answers
    const answers = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as ApplicationAnswers
      : {}
    return { answers, declared: saved?.declared === true }
  } catch {
    return { answers: {}, declared: false }
  }
}

export function UserApply() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const source = params.get('source') === 'match' ? 'match' : 'explore'
  const { profile, session } = useAuth()
  const navigate = useNavigate()
  const [listing, setListing] = useState<PublicListing | null>(null)
  const [existing, setExisting] = useState<Application | null>(null)
  const [answers, setAnswers] = useState<ApplicationAnswers>({})
  const [declared, setDeclared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [schemaReady, setSchemaReady] = useState(false)
  const [matchReady, setMatchReady] = useState(false)
  const [preferences, setPreferences] = useState<AdopterPreferences | null>(null)
  const myPetIds = useMyPetIds(profile?.id)
  const submitting = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  // Unsent answers are kept for this browser tab, so a refresh or a detour does not lose them.
  const draftKey = profile && id ? `pawslink-application-draft:${profile.id}:${id}` : null
  const profileRef = useRef(profile)
  profileRef.current = profile

  useEffect(() => {
    const profile = profileRef.current
    if (!id || !profile) return
    let active = true
    ;(async () => {
      const [petResult, appResult, prefResult, schemaResult, strictSetup] = await Promise.all([
        supabase.from('public_listings').select('*').eq('listing_id', id).maybeSingle(),
        supabase.from('applications').select('*').eq('listing_id', id).eq('adopter_id', profile.id).maybeSingle(),
        supabase.from('adopter_preferences').select('*').eq('user_id', profile.id).maybeSingle(),
        supabase.from('applications').select('answers_json').limit(1),
        supabase.from('public_match_weights').select('version').single()
      ])
      if (!active) return
      const pet = petResult.data as PublicListing | null
      const traitResult = pet && source === 'match' ? await supabase.from('pet_match_traits').select('pet_id').eq('pet_id', pet.pet_id).maybeSingle() : null
      if (!active) return
      if (petResult.error || appResult.error) setError(explain(petResult.error || appResult.error))
      if (source === 'match' && (prefResult.error || traitResult?.error)) setError(explain(prefResult.error || traitResult?.error))
      if (schemaResult.error || strictSetup.error) setError(eligibilitySetupMessage)
      else setSchemaReady(true)
      setMatchReady(source !== 'match' || Boolean(prefResult.data && traitResult?.data))
      setListing(pet)
      setExisting(appResult.data as Application | null)
      const pref = prefResult.data as AdopterPreferences | null
      setPreferences(pref)
      const experience = ['', 'First-time owner', 'Some exposure', 'Some experience', 'Experienced owner', 'Very experienced handler']
      const draft = readApplicationDraft(`pawslink-application-draft:${profile.id}:${id}`)
      setAnswers({
        full_name: profile.name || '', address: profile.location || '', phone: profile.contact || '',
        email: session?.user.email || '', birth_date: profile.birth_date || '',
        ...(pref ? {
          children_present: pref.children_at_home ? 'Yes' : 'No',
          current_pets: pref.other_pets_at_home ? 'Yes' : 'No',
          ownership_experience: experience[pref.ownership_experience] || ''
        } : {}),
        ...draft.answers
      })
      setDeclared(draft.declared)
      setLoading(false)
    })()
    return () => { active = false }
  }, [id, profile?.id, session?.user.email, source])

  useEffect(() => {
    if (!draftKey || loading) return
    try { sessionStorage.setItem(draftKey, JSON.stringify({ answers, declared })) } catch { /* storage unavailable */ }
  }, [draftKey, loading, answers, declared])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!id || submitting.current) return
    const failures = validateAnswers(answers, declared)
    setErrors(failures)
    if (failures.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const { data, error: submitError } = await supabase.rpc('submit_adoption_application', {
        p_listing_id: id,
        p_answers: { ...normalizedAnswers(answers), declaration: true },
        p_source: source
      })
      if (submitError) setError(explain(submitError))
      else if (typeof data !== 'string') setError('Your application could not be confirmed. Please try again.')
      else {
        if (draftKey) { try { sessionStorage.removeItem(draftKey) } catch { /* storage unavailable */ } }
        navigate(`/app/applications/${data}`)
      }
    } catch (cause) {
      setError(explain(cause as { message?: string }))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const hasCompletedRequest = Boolean(existing && !needsApplicationForm(existing))
  const ownPet = Boolean(listing && myPetIds?.has(listing.pet_id))
  const canCompleteRequest = Boolean(listing && myPetIds && !ownPet && schemaReady && matchReady && !hasCompletedRequest)

  return <UserShell>
    <div className="page-head"><Link className="record-link" to={id ? `/app/listings/${id}` : '/app/bridge'}>← Back to pet</Link>
      <h1>Adoption application</h1><p className="sub">Tell CAVD about your household and your plan for this pet.</p></div>
    {loading ? <p role="status">Loading application…</p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {!loading && !listing ? <Empty>This pet is no longer open for applications.</Empty> : null}
    {listing ? <div className="application-pet card"><div className="avatar"><Photo url={listing.photo_url} name={listing.name} /></div>
      <div><h2>{listing.name}</h2><p className="sub">{petLine(listing)}</p></div></div> : null}
    {ownPet && listing ? <Notice kind="info">This is your pet. You can manage its listing from <Link to={`/app/pets/${listing.pet_id}`}>My pets</Link>.</Notice> : null}
    {!loading && listing && !ownPet && !hasCompletedRequest && !matchReady ?
      <Notice kind="info">Applications begin in <Link to="/app/match">Find My Match</Link>. Save your preferences and choose this pet from your ranked results.</Notice> : null}
    {hasCompletedRequest && existing ? <Notice kind="info">You already applied for this pet. <Link to={`/app/applications/${existing.id}`}>View your application</Link>.</Notice> : null}
    {existing && !existing.answers_json && existing.status === 'pending' ? <Notice kind="info">Your earlier request has no application form yet. Completing this one adds it to that request.</Notice> : null}
    {canCompleteRequest ? <form className="application-form" onSubmit={event => void submit(event)}>
      {source === 'match' && preferences ? <section className="card"><h2>Your Find My Match answers</h2>
        <PreferenceAnswers answers={preferences} />
        <Link className="record-link" to="/app/match">Change answers in Find My Match</Link>
      </section> : null}
      {errors.length ? <Notice kind="bad"><strong>Please check the form:</strong><ul>{errors.map(message => <li key={message}>{message}</li>)}</ul></Notice> : null}
      {APPLICATION_SECTIONS.map(section => <fieldset className="card" key={section.title}>
        <legend>{section.title}</legend><div className="application-field-grid">{section.fields.filter(field => fieldApplies(field.key, answers)).map(field =>
          <Field label={field.label} key={field.key}>
            {field.type === 'select' ? <select value={answers[field.key] || ''} required onChange={event => setAnswers(previous => ({ ...previous, [field.key]: event.target.value }))}>
              <option value="">Select an answer</option>{field.options?.map(option => <option value={option} key={option}>{option}</option>)}
            </select> : field.type === 'textarea' ? <textarea value={answers[field.key] || ''} maxLength={3000} required rows={3}
              onChange={event => setAnswers(previous => ({ ...previous, [field.key]: event.target.value }))} />
              : <input type={field.type} value={answers[field.key] || ''} maxLength={3000} required
                min={field.type === 'number' ? '0' : undefined} max={field.type === 'number' ? '24' : field.type === 'date' ? todayInputDate() : undefined}
                step={field.type === 'number' ? '0.5' : undefined}
                onChange={event => setAnswers(previous => ({ ...previous, [field.key]: event.target.value }))} />}
          </Field>)}</div>
      </fieldset>)}
      <label className="application-declaration"><input type="checkbox" checked={declared} required onChange={event => setDeclared(event.target.checked)} />
        <span>I confirm my answers are accurate. CAVD may request more information or an interview and makes the final adoption decision.</span></label>
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit application for CAVD review'}</button>
    </form> : null}
  </UserShell>
}

export function UserApplicationDetail() {
  const { id } = useParams()
  const [application, setApplication] = useState<Application | null>(null)
  const [pet, setPet] = useState<PublicListing | null>(null)
  const [history, setHistory] = useState<ApplicationEvent[]>([])
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    supabase.from('applications').select('*').eq('id', id).maybeSingle().then(async ({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(explain(loadError))
      const app = data as Application | null
      setApplication(app)
      setResponse(app?.applicant_response || '')
      if (app) {
        const [listingResult, historyResult] = await Promise.all([
          supabase.from('public_listings').select('*').eq('listing_id', app.listing_id).maybeSingle(),
          supabase.from('application_events').select('*').eq('application_id', app.id).order('created_at', { ascending: true })
        ])
        if (active) { setPet(listingResult.data as PublicListing | null); setHistory((historyResult.data || []) as ApplicationEvent[]) }
      }
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [id])

  async function sendResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!application) return
    setBusy(true); setError(null); setNotice(null)
    const { data, error: replyError } = await supabase.rpc('respond_to_adoption_application', {
      p_application_id: application.id, p_response: response.trim()
    })
    setBusy(false)
    if (replyError) setError(explain(replyError))
    else { setApplication(data as Application); setNotice('Response sent to CAVD.') }
  }

  return <UserShell>
    <div className="page-head"><Link className="record-link" to="/app/applications">← My applications</Link>
      <h1>{pet?.name || application?.pet_name_snapshot ? `${pet?.name || application?.pet_name_snapshot} · application` : 'Adoption application'}</h1></div>
    {loading ? <p role="status">Loading application…</p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {notice ? <Notice kind="ok">{notice}</Notice> : null}
    {!loading && !application ? <Empty>Application not found.</Empty> : null}
    {application ? <>
      <div className="card"><p>Submitted {fmtDate(application.created_at)} · <strong>{stageLabel(application.review_stage, application.status)}</strong> {discoveryPill(application.discovery_path)}</p>
        <ApplicationTracker stage={application.review_stage} status={application.status} />
        <ApplicationSource application={application} />
        {!application.answers_json && application.message ? <p><strong>Earlier message:</strong> {application.message}</p> : null}
        
        {!application.answers_json && application.status === 'pending' && pet ? <Link className="btn btn-sm" to={`/app/listings/${application.listing_id}/apply?source=explore`}>Complete application form</Link> : null}
      </div>
      <StampedPreferences application={application} />
      {application.answers_json ? <ApplicationAnswersView answers={application.answers_json} /> : null}
      <section className="card"><h2>CAVD remarks and next steps</h2>
        <p className="application-preline">{application.cavd_remarks || application.decision_note || 'No remarks yet.'}</p>
        {application.reviewed_at ? <p className="sub">Updated {fmtDate(application.reviewed_at)}</p> : null}
        {application.applicant_response ? <><h3>Your response</h3><p className="application-preline">{application.applicant_response}</p>
          {application.response_date ? <p className="sub">Sent {fmtDate(application.response_date)}</p> : null}</> : null}
        {application.status === 'pending' && ['for_interview', 'additional_requirements'].includes(application.review_stage) ?
          <form onSubmit={event => void sendResponse(event)}><Field label="Respond to CAVD"><textarea value={response} maxLength={6000} required
            onChange={event => setResponse(event.target.value)} /></Field>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send response to CAVD'}</button></form> : null}
      </section>
      <ApplicationHistory events={history} />
    </> : null}
  </UserShell>
}

export function OfficeApplicationDetail() {
  const { id } = useParams()
  const eligibility = useEligibilityReport()
  const [application, setApplication] = useState<Application | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [pet, setPet] = useState<Pet | null>(null)
  const [adopter, setAdopter] = useState<Profile | null>(null)
  const [history, setHistory] = useState<ApplicationEvent[]>([])
  const [stage, setStage] = useState<ReviewStage>('pending_review')
  const [remarks, setRemarks] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const navigate = useNavigate()
  const who = useNames(history.map(event => event.actor_id))

  const load = useCallback(async () => {
    if (!id) return
    const { data, error: appError } = await supabase.from('applications').select('*').eq('id', id).maybeSingle()
    if (appError) setError(explain(appError))
    const app = data as Application | null
    setApplication(app)
    setStage(app?.review_stage || 'pending_review')
    setRemarks(app?.cavd_remarks || '')
    if (app) {
      const [listingResult, adopterResult, historyResult] = await Promise.all([
        supabase.from('listings').select('*').eq('id', app.listing_id).maybeSingle(),
        supabase.from('profiles').select('*').eq('id', app.adopter_id).maybeSingle(),
        supabase.from('application_events').select('*').eq('application_id', app.id).order('created_at', { ascending: true })
      ])
      const nextListing = listingResult.data as Listing | null
      setListing(nextListing)
      setAdopter(adopterResult.data as Profile | null)
      setHistory((historyResult.data || []) as ApplicationEvent[])
      if (nextListing) {
        const { data: petData } = await supabase.from('pets').select('*').eq('id', nextListing.pet_id).maybeSingle()
        setPet(petData as Pet | null)
      }
    }
    setLoading(false)
  }, [id])
  useEffect(() => { void load() }, [load])

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!application) return
    setBusy(true); setError(null); setNotice(null)
    const { error: reviewError } = await supabase.rpc('review_adoption_application', {
      p_application_id: application.id, p_stage: stage, p_remarks: remarks.trim()
    })
    setBusy(false)
    if (reviewError) setError(explain(reviewError))
    else { setNotice('Review stage and remarks saved.'); void load() }
  }

  return <OfficeShell>
    <div className="page-head"><Link className="record-link" to="/office/applications">← Applications queue</Link>
      <h1>Review adoption application {application ? discoveryPill(application.discovery_path) : null}</h1><p className="sub">{pet?.name || 'Pet'} · {adopter?.name || 'Applicant'}</p></div>
    {loading ? <p role="status">Loading application…</p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {notice ? <Notice kind="ok">{notice}</Notice> : null}
    {!loading && !application ? <Empty>Application not found.</Empty> : null}
    {application ? <>
      <div className="card"><p><strong>{stageLabel(application.review_stage, application.status)}</strong> · submitted {fmtDate(application.created_at)}</p>
        <ApplicationSource application={application} />
        {adopter ? <p>Applicant: {adopter.name} · {adopter.contact || 'No contact number on profile'}</p> : null}
        {adopter ? <Link className="record-link" to={`/office/accounts/${adopter.id}`}>View applicant profile and submitted ID</Link> : null}
        {!application.answers_json && application.message ? <Notice kind="info">Message sent with the earlier request:<p>{application.message}</p></Notice> : null}
      </div>
      <StampedPreferences application={application} />
      {application.answers_json ? <ApplicationAnswersView answers={application.answers_json} /> : null}
      <section className="card"><h2>Conversation</h2>
        <p className="application-preline"><strong>CAVD remarks:</strong> {application.cavd_remarks || application.decision_note || 'None yet.'}</p>
        {application.applicant_response ? <><p className="application-preline"><strong>Applicant response:</strong> {application.applicant_response}</p>
          {application.response_date ? <p className="sub">Received {fmtDate(application.response_date)}</p> : null}</> : null}
      </section>
      <ApplicationHistory events={history} who={who} />
      {application.status === 'pending' ? <section className="card"><h2>CAVD review</h2>
        <form onSubmit={event => void review(event)}><Field label="Review stage"><select value={stage} onChange={event => setStage(event.target.value as ReviewStage)}>
          <option value="pending_review">Pending review</option><option value="under_review">Under review</option>
          <option value="for_interview">For interview</option><option value="additional_requirements">Additional requirements needed</option>
          <option value="rejected">Declined</option>
        </select></Field>
          <Field label="Remarks, requirements, or interview instructions"><textarea value={remarks} maxLength={6000}
            required={['for_interview','additional_requirements','rejected'].includes(stage)} onChange={event => setRemarks(event.target.value)} /></Field>
          <p className="sub">The adopter can read these remarks. Include how to arrange an interview or provide requested documents.</p>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save review stage'}</button></form>
        {!application.answers_json ? <p className="sub">The adopter must complete the application form before approval.</p> : null}
        {pet && !eligibility.report?.find(row => row.pet_id === pet.id)?.eligible ? <Notice kind="warn">{eligibility.error || 'Final approval is paused until the pet passes every adoption eligibility condition.'} <Link to={`/office/pets/${pet.id}#adoption-eligibility`}>Review pet eligibility</Link>.</Notice> : null}
        {application.answers_json && pet && eligibility.report?.find(row => row.pet_id === pet.id)?.eligible && listing?.status === 'approved' ? <div className="application-transfer"><h3>Final approval</h3>
          <p className="sub">Review the applicant’s information, then validate the request with the owner or through a CAVD visit before transferring ownership.</p>
          <CavdTransferControl application={{ ...application, pet, adopter: adopter || undefined }}
            onError={setError} onDone={() => { setNotice('Ownership transferred. Listing closed.'); void load() }} />
        </div> : null}
      </section> : null}
      {application.status !== 'pending' ? <button className="btn btn-sm btn-outline" onClick={() => navigate('/office/applications')}>Back to queue</button> : null}
    </> : null}
  </OfficeShell>
}
