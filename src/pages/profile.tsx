import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { accountDestination, needsProfileSetup } from '../lib/onboarding'
import { appUrl } from '../lib/format'
import { explain, supabase } from '../lib/supabase'
import { Field, Notice, PawMark } from '../ui'
import { UserShell } from './user'

const photoTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function photoFailure(error: { message?: string; code?: string }) {
  if (/bucket not found|NoSuchBucket|column .*avatar_path.*does not exist/i.test(error.message || '')) {
    return 'Profile photos are unavailable right now. Please contact the PawsLink administrator.'
  }
  return explain(error)
}

function missingProfileFields(message: string) {
  return /(?:column .*\.(?:location|birth_date|avatar_path) does not exist|could not find the '(?:location|birth_date|avatar_path)' column)/i.test(message)
}

function detailsFailure(error: { message?: string; code?: string }) {
  if (missingProfileFields(error.message || '')) {
    return 'Your changes were not saved. Profile setup is temporarily unavailable because the account database needs an update. Please contact the PawsLink administrator.'
  }
  return `Your changes were not saved. ${explain(error)}`
}

export function UserProfile() {
  const { profile, session, verification, refresh } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [contact, setContact] = useState(profile?.contact || '')
  const [location, setLocation] = useState(profile?.location || '')
  const [birthDate, setBirthDate] = useState(profile?.birth_date || '')
  const [email, setEmail] = useState(session?.user.email || '')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoMessage, setPhotoMessage] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [schemaMissing, setSchemaMissing] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    let active = true
    supabase.from('profiles').select('location,birth_date,avatar_path').eq('id', profile.id).maybeSingle()
      .then(({ error: checkError }) => {
        if (active) setSchemaMissing(Boolean(checkError && missingProfileFields(checkError.message)))
      })
    return () => { active = false }
  }, [profile?.id])

  if (!profile || !session) return null
  const onboarding = needsProfileSetup(profile, session.user)
  const avatarUrl = profile.avatar_path
    ? supabase.storage.from('profile-photos').getPublicUrl(profile.avatar_path).data.publicUrl
    : null

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null
    setPhotoError(null)
    setPhotoMessage(null)
    if (!file) { setPhoto(null); return }
    if (!photoTypes[file.type]) {
      setPhoto(null)
      setPhotoError('Choose a JPG, PNG, or WebP profile photo.')
      event.target.value = ''
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setPhoto(null)
      setPhotoError('Profile photos must be 3 MB or smaller.')
      event.target.value = ''
      return
    }
    setPhoto(file)
  }

  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !photo) return
    const form = event.currentTarget
    setPhotoBusy(true)
    setPhotoError(null)
    setPhotoMessage(null)
    const path = `${profile.id}/${crypto.randomUUID()}.${photoTypes[photo.type]}`
    let uploaded = false
    let linked = false
    try {
      const { error: uploadError } = await supabase.storage.from('profile-photos')
        .upload(path, photo, { contentType: photo.type, upsert: false })
      if (uploadError) throw uploadError
      uploaded = true
      const { data, error: updateError } = await supabase.from('profiles')
        .update({ avatar_path: path }).eq('id', profile.id).select('avatar_path').single()
      if (updateError || data?.avatar_path !== path) throw updateError || new Error('Photo was uploaded but could not be saved to your profile.')
      linked = true
      await refresh()
      setPhoto(null)
      form.reset()
      setPhotoMessage('Profile photo updated successfully.')
    } catch (cause) {
      if (uploaded && !linked) await supabase.storage.from('profile-photos').remove([path])
      setPhotoError(photoFailure(cause as { message?: string; code?: string }))
    } finally {
      setPhotoBusy(false)
    }
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault()
    if (!profile || !session) return
    if (!name.trim()) {
      setDetailsError('Enter your full name before saving.')
      return
    }
    if (birthDate && birthDate > new Date().toISOString().slice(0, 10)) {
      setDetailsError('Your birthday cannot be in the future.')
      return
    }
    setBusy(true); setDetailsError(null); setDetailsMessage(null)
    let detailsSaved = false
    try {
      const { data: updated, error: updateError } = await supabase.from('profiles').update({
        name: name.trim(), contact: contact.trim() || null, location: location.trim() || null,
        birth_date: birthDate || null
      }).eq('id', profile.id).select('id').single()
      if (updateError || !updated) throw updateError || new Error('The profile update did not return a saved record.')
      detailsSaved = true
      let nextUser = session.user
      if (onboarding) {
        const { data: completion, error: completionError } = await supabase.auth.updateUser({ data: { profile_setup_complete: true } })
        if (completionError || completion.user?.user_metadata.profile_setup_complete !== true) {
          throw completionError || new Error('Your details were saved, but account setup could not be completed. Please try again.')
        }
        nextUser = completion.user
      }
      const next = accountDestination(profile, nextUser, verification)
      setDetailsMessage('Profile saved. Continuing…')
      // A full navigation reloads the current account state before route guards run.
      window.location.replace(appUrl(next))
    } catch (err) {
      const failure = err as { message?: string; code?: string }
      if (missingProfileFields(failure.message || '')) setSchemaMissing(true)
      setDetailsError(detailsSaved
        ? `${onboarding ? 'Your details were saved, but account setup could not be completed.' : 'Your details were saved, but the page could not refresh.'} ${explain(failure)}`
        : detailsFailure(failure))
    } finally {
      setBusy(false)
    }
  }

  async function saveEmail(e: FormEvent) {
    e.preventDefault()
    if (!session || email.trim().toLowerCase() === session.user.email?.toLowerCase()) return
    setEmailBusy(true); setEmailError(null); setEmailMessage(null)
    try {
      const { error: changeError } = await supabase.auth.updateUser(
        { email: email.trim() }, { emailRedirectTo: appUrl('/app/profile') }
      )
      if (changeError) throw changeError
      setEmailMessage('Email change requested. Check your inbox for a confirmation link before using the new address to log in.')
    } catch (cause) {
      setEmailError(explain(cause as { message?: string; code?: string }))
    } finally {
      setEmailBusy(false)
    }
  }

  return <UserShell showIdentity={!onboarding}>
    <div className="page-head"><div className="step-label">{onboarding ? 'Step 3 of 4 · Make it yours' : 'Account details'}</div><h1>{onboarding ? 'Customize your profile' : 'My profile'}</h1><p className="sub">{onboarding ? 'Add a photo and check your details before continuing. You can update them later in My profile.' : 'Manage your photo, personal details, and login email.'}</p></div>
    {onboarding ? <Notice kind="ok">Registration complete. Save your profile to continue to your PawsLink space.</Notice> : null}
    <div className="profile-layout">
      <form className="card profile-photo-panel" onSubmit={uploadPhoto}>
        <div className="profile-photo">{avatarUrl && failedAvatarUrl !== avatarUrl ? <img src={avatarUrl} alt="Your profile" onError={() => {
          setFailedAvatarUrl(avatarUrl)
          setPhotoMessage(null)
          setPhotoError('Your saved profile photo could not be displayed. Please try uploading it again.')
        }} /> : <PawMark />}</div>
        <h2>Profile photo</h2>
        <p className="sub">Choose a photo, then upload it here. Saving personal details is a separate action.</p>
        <Field label="Choose a new photo" hint="JPG, PNG, or WebP · up to 3 MB">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} aria-describedby="profile-photo-feedback" disabled={photoBusy} />
        </Field>
        {photo ? <p className="hint">Selected: {photo.name}</p> : null}
        <button className="btn btn-outline" type="submit" disabled={!photo || photoBusy}>{photoBusy ? 'Uploading photo…' : 'Upload photo'}</button>
        <div id="profile-photo-feedback" aria-live="polite">
          {photoError ? <div role="alert"><Notice kind="bad">{photoError}</Notice></div> : null}
          {photoMessage ? <Notice kind="ok">{photoMessage}</Notice> : null}
        </div>
      </form>
      <div>
        <form id="profile-details" className="card profile-form" onSubmit={saveDetails} noValidate>
          <h2>Personal details</h2>
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} required /></Field>
          <div className="grid grid-2">
            <Field label="Birthday"><input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={e => setBirthDate(e.target.value)} /></Field>
            <Field label="Phone number"><input type="tel" value={contact} onChange={e => setContact(e.target.value)} autoComplete="tel" /></Field>
          </div>
          <Field label="Location" hint="Barangay and city are enough; avoid sharing a full street address if you prefer."><input value={location} onChange={e => setLocation(e.target.value)} autoComplete="address-level2" placeholder="e.g. Ampayon, Butuan City" /></Field>
          {schemaMissing ? <div role="alert"><Notice kind="bad">Profile updates are unavailable because the account database needs an update. Please contact the PawsLink administrator.</Notice></div> : null}
          <button className="btn" type="submit" disabled={busy || photoBusy}>{busy ? 'Saving…' : onboarding ? 'Save profile and continue' : 'Save profile'}</button>
          <div aria-live="polite">
            {detailsError ? <div role="alert"><Notice kind="bad">{detailsError}</Notice></div> : null}
            {detailsMessage ? <Notice kind="ok">{detailsMessage}</Notice> : null}
          </div>
          {onboarding ? <p className="hint">Your photo, birthday, phone number, and location are optional.</p> : null}
        </form>
        <form className="card profile-form" onSubmit={saveEmail}>
          <h2>Email address</h2>
          <p className="sub">Current login email: <strong>{session.user.email}</strong></p>
          <Field label="New email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <button className="btn btn-outline" type="submit" disabled={emailBusy || email.trim().toLowerCase() === session.user.email?.toLowerCase()}>{emailBusy ? 'Requesting…' : 'Change email'}</button>
          <div aria-live="polite">
            {emailError ? <div role="alert"><Notice kind="bad">{emailError}</Notice></div> : null}
            {emailMessage ? <Notice kind="ok">{emailMessage}</Notice> : null}
          </div>
          <p className="hint">For your security, follow any confirmation link sent to your inbox before signing in with the new email.</p>
        </form>
      </div>
    </div>
  </UserShell>
}
