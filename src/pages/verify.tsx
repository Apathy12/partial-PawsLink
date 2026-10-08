import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { appUrl, homeFor } from '../lib/format'
import { explain, supabase } from '../lib/supabase'
import { assessIdentityOcr, readIdentityDocument, type IdentityOcrAssessment } from '../lib/identity-ocr'
import type { VerificationRequest } from '../lib/types'
import { IdentityOcrReport } from '../identity-ocr-report'
import { CivicFrame, Field, Notice, PawMark } from '../ui'

const allowedFiles: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf'
}

type ScanState = {
  file: File
  idType: VerificationRequest['id_type']
  name: string
  prcNumber: string
  assessment: IdentityOcrAssessment | null
  error: string | null
}

export function VerifyIdentityPage() {
  const { profile, session, verification, refresh, signOut } = useAuth()
  const requestedRole = profile?.registration_kind || (session?.user.user_metadata?.requested_role === 'vet' ? 'vet' : 'user')
  const isVet = requestedRole === 'vet'
  const [idType, setIdType] = useState<VerificationRequest['id_type']>('national_id')
  const [clinicName, setClinicName] = useState(verification?.clinic_name || session?.user.user_metadata?.clinic_name || '')
  const [prcNumber, setPrcNumber] = useState(verification?.prc_number || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanState | null>(null)
  const [scanProgress, setScanProgress] = useState<string | null>(null)
  const [acceptScanWarnings, setAcceptScanWarnings] = useState(false)

  if (!profile || !session) return null
  if (profile.verification_exempt !== false || verification?.status === 'approved') {
    return <Navigate to={homeFor(profile.role)} replace />
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!profile) return
    const form = e.currentTarget
    const file = (form.elements.namedItem('document') as HTMLInputElement | null)?.files?.[0]
    if (!file || !file.size) { setError('Choose a clear photo or PDF of your ID.'); return }
    const ext = allowedFiles[file.type]
    if (!ext) { setError('Use a JPG, PNG, or PDF file.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('The ID file must be 5 MB or smaller.'); return }

    setBusy(true)
    setError(null)
    setStatusMessage(null)
    let uploadedPath: string | null = null
    try {
      const chosenType = isVet ? 'prc_id' : idType
      const enteredNumber = isVet ? prcNumber.trim() : ''
      let currentScan = scan?.file === file && scan.idType === chosenType
        && scan.name === profile.name && scan.prcNumber === enteredNumber ? scan : null
      if (!currentScan) {
        setScanProgress('Preparing document text check…')
        try {
          const read = await readIdentityDocument(file, setScanProgress)
          currentScan = {
            file, idType: chosenType, name: profile.name, prcNumber: enteredNumber,
            assessment: assessIdentityOcr(read, { name: profile.name, idType: chosenType, prcNumber: enteredNumber }),
            error: null
          }
        } catch (scanError) {
          currentScan = {
            file, idType: chosenType, name: profile.name, prcNumber: enteredNumber,
            assessment: null,
            error: explain(scanError as { message?: string }, 'The ID text could not be read.')
          }
        }
        setScan(currentScan)
        setScanProgress(null)
        setAcceptScanWarnings(false)
      }
      if ((currentScan.error || currentScan.assessment?.warnings.length) && !acceptScanWarnings) {
        setError('Review the document text check, then choose a clearer file or confirm that you want to submit this one.')
        return
      }

      const path = `${profile.id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('identity-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      uploadedPath = path

      const { data: request, error: requestError } = await supabase.from('verification_requests').insert({
        user_id: profile.id,
        requested_role: requestedRole,
        id_type: requestedRole === 'vet' ? 'prc_id' : idType,
        id_path: path,
        clinic_name: requestedRole === 'vet' ? clinicName.trim() : null,
        prc_number: requestedRole === 'vet' ? prcNumber.trim() : null
      }).select('status').single()
      if (requestError || !request) throw requestError || new Error('The ID submission could not be confirmed.')
      uploadedPath = null
      await refresh()
      if (isVet) {
        setStatusMessage('Your PRC ID was submitted. CAVD will review it before veterinary tools become available.')
      } else if (request.status === 'approved') {
        window.location.replace(appUrl('/app'))
      } else {
        setError('Your ID was saved, but automatic owner access is not active yet. Please ask the PawsLink administrator to apply migration 0009.')
      }
    } catch (err) {
      const cleanup = uploadedPath
        ? await supabase.storage.from('identity-documents').remove([uploadedPath])
        : null
      setError(`${explain(err as { message?: string })}${cleanup?.error ? ' The uploaded file could not be removed; please contact CAVD.' : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const pending = verification?.status === 'pending'
  return (
    <CivicFrame variant="public" serviceName={isVet ? 'Account verification' : 'Finish your account'} nav={[
      { to: '/', label: 'Home' }, { to: '/verify', label: 'My ID', end: true }
    ]} action={<button className="header-action" type="button" onClick={() => void signOut()}>Log out</button>}>
      <div className="verification-layout">
        <div>
          <div className="step-label">Final step · ID upload</div>
          <h1>One last step, {profile.name.split(' ')[0]}</h1>
          <p className="sub">{isVet
            ? 'Submit a clear PRC professional ID. CAVD reviews it before veterinary access starts.'
            : 'Upload a clear, valid government ID to finish your owner/adopter account. Your space opens as soon as the upload is recorded.'} Your document stays private.</p>
          {requestedRole === 'user' ? <p className="sub"><Link to="/app/profile">Review or update your profile</Link></p> : null}
          {statusMessage ? <Notice kind="ok">{statusMessage}</Notice> : null}
          {error ? <Notice kind="bad">{error}</Notice> : null}
          {pending ? (
            <div className="card verification-status">
              <h2>{isVet ? 'Your PRC ID is with CAVD' : 'Your ID is recorded'}</h2>
              <p>{isVet ? 'CAVD will review your PRC ID. Veterinary tools stay locked until approval.' : 'Your owner access should open after the ID submission is processed. Refresh this page; if it stays here, ask the PawsLink administrator to apply migration 0009.'}</p>
              <button className="btn btn-outline" type="button" onClick={() => void refresh()}>{isVet ? 'Check review status' : 'Refresh account status'}</button>
            </div>
          ) : (
            <>
              {verification?.status === 'rejected' ? <Notice kind="warn">{isVet ? 'CAVD asked for a new document' : 'Please submit your ID again'}: {verification.review_note || 'Please submit a clearer valid ID.'}</Notice> : null}
              <form className="card verification-form" onSubmit={submit}>
                <h2>{isVet ? 'Submit your PRC ID' : 'Submit your government ID'}</h2>
                <p className="sub">Account type: <strong>{isVet ? 'Veterinarian / clinic' : 'Pet owner / adopter'}</strong></p>
                {isVet ? <>
                  <Field label="Clinic name"><input value={clinicName} onChange={e => setClinicName(e.target.value)} required /></Field>
                  <Field label="PRC license number"><input value={prcNumber} onChange={e => { setPrcNumber(e.target.value); setScan(null); setError(null); setAcceptScanWarnings(false) }} required /></Field>
                  <p className="sub">Upload your PRC professional ID. CAVD checks it before granting veterinarian access.</p>
                </> : <Field label="Government ID type">
                  <select value={idType} onChange={e => { setIdType(e.target.value as VerificationRequest['id_type']); setScan(null); setError(null); setAcceptScanWarnings(false) }}>
                    <option value="national_id">National ID</option>
                    <option value="drivers_license">Driver’s license</option>
                    <option value="passport">Passport</option>
                    <option value="other_government_id">Other government-issued ID</option>
                  </select>
                </Field>}
                {!isVet && idType === 'national_id' ? <p className="hint">A text scan cannot authenticate a National ID. For its QR signature, use the <a href="https://everify.gov.ph/check" target="_blank" rel="noreferrer">official National ID Check</a>.</p> : null}
                <Field label={isVet ? 'Photo or PDF of your PRC ID' : 'Photo or PDF of your valid ID'} hint="JPG, PNG, or PDF · up to 5 MB · include all text and edges">
                  <input type="file" name="document" accept="image/jpeg,image/png,application/pdf" onChange={() => { setScan(null); setError(null); setAcceptScanWarnings(false) }} required />
                </Field>
                <IdentityOcrReport assessment={scan?.assessment} error={scan?.error} />
                {scan && (scan.error || scan.assessment?.warnings.length) ? <label className="check-row">
                  <input type="checkbox" checked={acceptScanWarnings} onChange={e => { setAcceptScanWarnings(e.target.checked); if (e.target.checked) setError(null) }} />
                  I checked the ID myself and want to submit it for this account.
                </label> : null}
                <button className="btn" type="submit" disabled={busy}>{busy ? scanProgress || 'Submitting…' : isVet ? 'Check and send PRC ID to CAVD' : 'Check and upload ID'}</button>
                <p className="hint">The text check runs in your browser. It may miss valid text and does not verify that an ID is genuine.</p>
              </form>
            </>
          )}
          <p className="sub">Wrong account? <button className="text-button" type="button" onClick={() => void signOut()}>Log out</button> and <Link to="/login">log in again</Link>.</p>
        </div>
        <aside className="verification-aside"><PawMark /><h2>Your next steps</h2><ol><li>Confirm your email.</li><li>Upload a valid {isVet ? 'PRC' : 'government'} ID.</li>{isVet ? <li>Wait for CAVD’s decision.</li> : null}<li>Start using your PawsLink space.</li></ol></aside>
      </div>
    </CivicFrame>
  )
}
