import { useState, type FormEvent, type ReactNode } from 'react'
import { fmtDate } from './format'
import { explain, supabase } from './supabase'
import type { Pet, Profile, Visit } from './types'
import { Empty, Field, Notice, Pill } from '../ui'

const visitKinds: Record<string, string> = {
  checkup: 'Checkup', vaccination: 'Vaccination', illness: 'Illness',
  emergency: 'Emergency', follow_up: 'Follow-up', other: 'Other'
}

function formText(data: FormData, key: string) {
  return String(data.get(key) || '').trim()
}

function optionalText(data: FormData, key: string) {
  return formText(data, key) || null
}

async function uploadVisitDocument(userId: string, file: File) {
  const allowed: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'application/pdf': 'pdf'
  }
  const ext = allowed[file.type]
  if (!ext) throw new Error('Choose a JPG, PNG, WebP, or PDF document.')
  if (file.size > 8 * 1024 * 1024) throw new Error('The document must be 8 MB or smaller.')
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('visit-documents').upload(path, file, {
    upsert: false, contentType: file.type
  })
  if (error) throw error
  return path
}

export function VisitForm({ pet, profile, onSaved, embedded = false }: {
  pet: Pet; profile: Profile; onSaved: () => void; embedded?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [hasVaccine, setHasVaccine] = useState(false)
  const [visitType, setVisitType] = useState('checkup')
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('evidence') as File | null
    let evidence_path: string | null = null
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      if (file?.size) evidence_path = await uploadVisitDocument(profile.id, file)
      const { error: insertError } = await supabase.from('visits').insert({
        pet_id: pet.id,
        recorded_by: profile.id,
        clinic_name: formText(data, 'clinic_name'),
        visit_date: formText(data, 'visit_date'),
        visit_type: formText(data, 'visit_type'),
        reason: formText(data, 'reason'),
        summary: formText(data, 'summary'),
        history: optionalText(data, 'history'),
        weight_kg: optionalText(data, 'weight_kg'),
        exam_findings: optionalText(data, 'exam_findings'),
        assessment: optionalText(data, 'assessment'),
        diagnostics: optionalText(data, 'diagnostics'),
        procedures: optionalText(data, 'procedures'),
        medications: optionalText(data, 'medications'),
        owner_instructions: optionalText(data, 'owner_instructions'),
        follow_up_on: optionalText(data, 'follow_up_on'),
        vaccine_name: hasVaccine ? optionalText(data, 'vaccine_name') : null,
        vaccine_manufacturer: hasVaccine ? optionalText(data, 'vaccine_manufacturer') : null,
        vaccine_lot: hasVaccine ? optionalText(data, 'vaccine_lot') : null,
        vaccine_expires_on: hasVaccine ? optionalText(data, 'vaccine_expires_on') : null,
        vaccine_route: hasVaccine ? optionalText(data, 'vaccine_route') : null,
        vaccine_site: hasVaccine ? optionalText(data, 'vaccine_site') : null,
        vaccine_administered_by: hasVaccine ? optionalText(data, 'vaccine_administered_by') : null,
        vaccine_next_due_on: hasVaccine ? optionalText(data, 'vaccine_next_due_on') : null,
        vaccine_adverse_event: hasVaccine ? optionalText(data, 'vaccine_adverse_event') : null,
        evidence_path
      })
      if (insertError) throw insertError
      setSaved(true)
      setHasVaccine(false)
      setVisitType('checkup')
      form.reset()
      onSaved()
    } catch (cause) {
      if (evidence_path) {
        await supabase.storage.from('visit-documents').remove([evidence_path])
      }
      setError(explain(cause as { message?: string; code?: string }))
    } finally {
      setBusy(false)
    }
  }

  return <form className={`form-panel visit-form${embedded ? ' visit-form-embedded' : ' card'}`} onSubmit={submit}>
    <h2>{embedded ? 'Visit details' : 'Add a veterinary visit'}</h2>
    <p className="sub">A signed-in clinician records what happened. Saved visits are locked; CAVD can correct them with an audit note.</p>
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {saved ? <Notice kind="ok">Visit added to this pet’s private medical record.</Notice> : null}
    <div className="grid grid-2">
      <Field label="Visit date"><input type="date" name="visit_date" max={new Date().toISOString().slice(0, 10)} value={visitDate} onChange={e => setVisitDate(e.target.value)} required /></Field>
      <Field label="Visit type"><select name="visit_type" value={visitType} onChange={e => {
        setVisitType(e.target.value)
        if (e.target.value === 'vaccination') setHasVaccine(true)
      }} required>
        {Object.entries(visitKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label="Clinic"><input name="clinic_name" required defaultValue={profile.clinic_name || (profile.role === 'cavd' ? 'CAVD Animal Health Unit' : '')} /></Field>
      <Field label="Weight at visit (kg)"><input type="number" name="weight_kg" min="0.01" max="500" step="0.01" defaultValue={pet.weight_kg ?? ''} /></Field>
    </div>
    <Field label="Reason for visit"><input name="reason" required placeholder="What brought the pet to the clinic?" /></Field>
    <Field label="Visit summary"><textarea name="summary" required placeholder="Short overview for the pet’s timeline" /></Field>
    <details className="record-fields"><summary>Clinical details</summary>
      <div className="grid grid-2">
        <Field label="Relevant history"><textarea name="history" /></Field>
        <Field label="Examination findings"><textarea name="exam_findings" /></Field>
        <Field label="Assessment / diagnosis"><textarea name="assessment" /></Field>
        <Field label="Tests and results"><textarea name="diagnostics" /></Field>
        <Field label="Procedures / treatment"><textarea name="procedures" /></Field>
        <Field label="Medicines and dosage instructions"><textarea name="medications" /></Field>
      </div>
      <Field label="Owner care instructions"><textarea name="owner_instructions" /></Field>
      <Field label="Follow-up due"><input type="date" name="follow_up_on" min={visitDate} /></Field>
    </details>
    <label className="check-row"><input type="checkbox" checked={hasVaccine} disabled={visitType === 'vaccination'} onChange={e => setHasVaccine(e.target.checked)} /> A vaccine was administered at this visit</label>
    {hasVaccine ? <div className="record-fields vaccine-fields">
      <h3>Vaccination details</h3>
      <div className="grid grid-2">
        <Field label="Vaccine / product"><input name="vaccine_name" required={hasVaccine} placeholder="e.g. Rabies" /></Field>
        <Field label="Manufacturer"><input name="vaccine_manufacturer" /></Field>
        <Field label="Lot / serial number"><input name="vaccine_lot" required={hasVaccine} /></Field>
        <Field label="Product expiry"><input type="date" name="vaccine_expires_on" required={hasVaccine} min={visitDate} /></Field>
        <Field label="Route"><input name="vaccine_route" placeholder="As recorded by the clinic" /></Field>
        <Field label="Injection site"><input name="vaccine_site" /></Field>
        <Field label="Administered by"><input name="vaccine_administered_by" required={hasVaccine} defaultValue={profile.name} /></Field>
        <Field label="Next due / valid through"><input type="date" name="vaccine_next_due_on" min={visitDate} /></Field>
      </div>
      <Field label="Adverse event, if any"><textarea name="vaccine_adverse_event" /></Field>
    </div> : null}
    <Field label="Supporting document (optional)" hint="Private JPG, PNG, WebP, or PDF; up to 8 MB.">
      <input type="file" name="evidence" accept="image/jpeg,image/png,image/webp,application/pdf" />
    </Field>
    <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save visit record'}</button>
  </form>
}

function isDemoVisit(visit: Visit) {
  return /^\[DEMO RECORD\]/i.test(visit.summary.trim())
}

function recordStatus(visit: Visit) {
  if (isDemoVisit(visit)) return 'Demo record'
  if (visit.verification_status === 'vet_confirmed') return 'Vet confirmed'
  if (visit.verification_status === 'cavd_confirmed') return 'CAVD recorded'
  return 'Earlier summary'
}

function RecordRow({ label, value }: { label: string; value?: ReactNode }) {
  return <tr><th scope="row">{label}</th><td>{value === null || value === undefined || value === '' ? 'Not recorded' : value}</td></tr>
}

export function VisitHistory({ visits, canCorrect, petName }: {
  visits: Visit[]; canCorrect?: (visit: Visit) => void; petName?: string
}) {
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = visits.find(visit => visit.id === selectedId) || visits[0]
  async function openDocument(path: string) {
    setDocumentError(null)
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const { data, error } = await supabase.storage.from('visit-documents').createSignedUrl(path, 60)
      if (error || !data?.signedUrl) throw error || new Error('Document unavailable.')
      if (tab) tab.location.href = data.signedUrl
      else window.location.assign(data.signedUrl)
    } catch (cause) {
      tab?.close()
      setDocumentError(explain(cause as { message?: string }))
    }
  }
  if (!visits.length) return <>
    <div className="table-wrap visit-history-wrap"><table className="tbl visit-history-table">
      <caption className="sr-only">Past veterinary visits</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Visit</th><th scope="col">Clinic</th><th scope="col">Summary</th><th scope="col">Record status</th><th scope="col">Details</th></tr></thead>
      <tbody><tr><td colSpan={6}><Empty>No veterinary visits have been recorded for {petName || 'this pet'} yet.</Empty></td></tr></tbody>
    </table></div>
    <section className="visit-selected"><h3>Full visit record</h3><p className="sub">Record a real visit to see its complete details here.</p></section>
  </>
  const hasVaccine = selected.visit_type === 'vaccination' || Boolean(selected.vaccine_name || selected.vaccine_lot || selected.vaccine_next_due_on)
  return <>
    {documentError ? <Notice kind="bad">{documentError}</Notice> : null}
    <div className="table-wrap visit-history-wrap"><table className="tbl visit-history-table">
      <caption className="sr-only">Past veterinary visits</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Visit</th><th scope="col">Clinic</th><th scope="col">Summary</th><th scope="col">Record status</th><th scope="col">Details</th></tr></thead>
      <tbody>{visits.map(visit => <tr className={selected.id === visit.id ? 'visit-row-selected' : undefined} key={visit.id}>
        <td><time dateTime={visit.visit_date}>{fmtDate(visit.visit_date)}</time></td>
        <td>{visitKinds[visit.visit_type] || 'Visit'}</td>
        <td>{visit.clinic_name}</td>
        <td className="visit-summary-cell">{visit.summary.length > 110 ? `${visit.summary.slice(0, 107)}…` : visit.summary}</td>
        <td><Pill kind={isDemoVisit(visit) || visit.verification_status === 'legacy_summary' ? 'wait' : 'ok'}>{recordStatus(visit)}</Pill></td>
        <td><button className="btn btn-sm btn-outline" type="button" aria-pressed={selected.id === visit.id} onClick={() => { setSelectedId(visit.id); setDocumentError(null) }}>{selected.id === visit.id ? 'Selected' : 'View record'}</button></td>
      </tr>)}</tbody>
    </table></div>

    <section className="visit-selected" aria-labelledby="selected-visit-heading">
      <div className="visit-selected-head"><div><h3 id="selected-visit-heading">Full visit record</h3><p className="sub">{fmtDate(selected.visit_date)} · {visitKinds[selected.visit_type] || 'Visit'} · {selected.clinic_name}</p></div>
        {canCorrect ? <button className="btn btn-sm btn-outline" type="button" onClick={() => canCorrect(selected)}>Correct summary with note</button> : null}
      </div>
      {isDemoVisit(selected) ? <Notice kind="warn">Prototype sample only. No real examination, diagnosis, treatment, or vaccination is documented by this visit.</Notice> : null}
      <div className="table-wrap visit-record-wrap"><table className="tbl visit-record-table">
        <caption className="sr-only">Full record for the {fmtDate(selected.visit_date)} visit</caption>
        <tbody>
          <tr className="visit-section-row"><th colSpan={2} scope="rowgroup">Visit and clinical details</th></tr>
          <RecordRow label="Visit date" value={fmtDate(selected.visit_date)} />
          <RecordRow label="Visit type" value={visitKinds[selected.visit_type] || 'Visit'} />
          <RecordRow label="Clinic" value={selected.clinic_name} />
          <RecordRow label="Recorded by" value={selected.recorded_by_name} />
          <RecordRow label="Reason for visit" value={selected.reason} />
          <RecordRow label="Summary" value={selected.summary} />
          <RecordRow label="Relevant history" value={selected.history} />
          <RecordRow label="Weight at visit" value={selected.weight_kg == null ? null : `${selected.weight_kg} kg`} />
          <RecordRow label="Examination findings" value={selected.exam_findings} />
          <RecordRow label="Assessment / diagnosis" value={selected.assessment} />
          <RecordRow label="Tests and results" value={selected.diagnostics} />
          <RecordRow label="Procedures / treatment" value={selected.procedures} />
          <RecordRow label="Medicines and dosage" value={selected.medications} />
          <RecordRow label="Owner care instructions" value={selected.owner_instructions} />
          <RecordRow label="Follow-up due" value={selected.follow_up_on ? fmtDate(selected.follow_up_on) : null} />
        </tbody>
        {hasVaccine ? <tbody>
            <tr className="visit-section-row"><th colSpan={2} scope="rowgroup">Vaccination details</th></tr>
            <RecordRow label="Vaccine / product" value={selected.vaccine_name} />
            <RecordRow label="Manufacturer" value={selected.vaccine_manufacturer} />
            <RecordRow label="Lot / serial number" value={selected.vaccine_lot} />
            <RecordRow label="Product expiry" value={selected.vaccine_expires_on ? fmtDate(selected.vaccine_expires_on) : null} />
            <RecordRow label="Route" value={selected.vaccine_route} />
            <RecordRow label="Injection site" value={selected.vaccine_site} />
            <RecordRow label="Administered by" value={selected.vaccine_administered_by} />
            <RecordRow label="Next due / valid through" value={selected.vaccine_next_due_on ? fmtDate(selected.vaccine_next_due_on) : null} />
            <RecordRow label="Adverse event" value={selected.vaccine_adverse_event} />
          </tbody> : null}
        <tbody>
          <tr className="visit-section-row"><th colSpan={2} scope="rowgroup">Record source</th></tr>
          <RecordRow label="Status" value={recordStatus(selected)} />
          <RecordRow label="Added on" value={fmtDate(selected.created_at)} />
          <RecordRow label="CAVD correction note" value={selected.correction_note} />
          <RecordRow label="Supporting document" value={selected.evidence_path ? <button className="record-link evidence-link" type="button" onClick={() => void openDocument(selected.evidence_path!)}>Open private document</button> : null} />
        </tbody>
      </table></div>
    </section>
  </>
}
