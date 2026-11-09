import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ageLabel, speciesLabel } from '../lib/format'
import {
  AGE_LABELS, AGE_VALUES, CRITERION_LABELS, DEFAULT_PREFERENCES, EXPERIENCE_LABELS, LEVEL_LABELS, MATCH_WEIGHTS,
  SIZE_LABELS, SIZE_VALUES, SPACE_LABELS, TEMPERAMENT_LABELS, TEMPERAMENT_VALUES, matchDraftKey, parseMatchDraft,
  rankListings, validMatchWeights, type MatchCriterion, type MatchWeights
} from '../lib/matching'
import { useMyPetIds } from '../lib/my-pets'
import { useSavedListings } from '../lib/saved-listings'
import { explain, supabase } from '../lib/supabase'
import type { AdopterPreferences, PetMatchTraits, PublicListing } from '../lib/types'
import { CardSkeletons, Empty, Field, ListingCard, Notice, PetCode, Photo, Pill, SaveListingButton, originBadge } from '../ui'
import { UserShell } from './user'
import { eligibilitySetupMessage } from '../lib/eligibility'

type Answers = Omit<AdopterPreferences, 'user_id' | 'updated_at'>

function PreferenceSlider({ name, label, value, labels, onChange }: {
  name: keyof Answers; label: string; value: number; labels: string[]; onChange: (value: number) => void
}) {
  const id = useId()
  return <div className="match-slider-field">
    <div className="match-slider-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{labels[value]}</output></div>
    <input className="match-slider-input" id={id} name={name} type="range" min="0" max={labels.length - 1} step="1" value={value}
      list={`${id}-stops`} aria-valuetext={labels[value]} title={labels.join(' · ')} onChange={event => onChange(Number(event.target.value))} />
    <datalist id={`${id}-stops`}>{labels.map((text, index) => <option key={text} value={index} label={text} />)}</datalist>
    <div className="match-slider-scale" aria-hidden="true"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
  </div>
}

function RatingField({ name, label, value, labels, onChange }: {
  name: keyof Answers; label: string; value: number; labels: string[]; onChange: (value: number) => void
}) {
  return <PreferenceSlider name={name} label={label} value={value - 1} labels={labels} onChange={index => onChange(index + 1)} />
}

export function UserMatch() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const saved = useSavedListings(profileId)
  const myPetIds = useMyPetIds(profileId)
  const [answers, setAnswers] = useState<Answers>(DEFAULT_PREFERENCES)
  const [listings, setListings] = useState<PublicListing[]>([])
  const [traits, setTraits] = useState<PetMatchTraits[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weights, setWeights] = useState<MatchWeights>(MATCH_WEIGHTS)
  const [weightVersion, setWeightVersion] = useState<number | null>(null)
  const [weightsConfirmed, setWeightsConfirmed] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [skipNotice, setSkipNotice] = useState('')

  useEffect(() => {
    if (!profileId) return
    let current = true
    ;(async () => {
      const [preference, open, matchTraits, settings] = await Promise.all([
        supabase.from('adopter_preferences').select('*').eq('user_id', profileId).maybeSingle(),
        supabase.from('public_listings').select('*').order('listed_at', { ascending: false }),
        supabase.from('pet_match_traits').select('*'),
        supabase.from('public_match_weights').select('*').single()
      ])
      if (!current) return
      const failure = preference.error || open.error || matchTraits.error
      if (failure) setError(explain(failure))
      else if (settings.error || !validMatchWeights(settings.data?.weights)) setError(eligibilitySetupMessage)
      else {
        setWeights(settings.data.weights)
        setWeightVersion(settings.data.version)
        setWeightsConfirmed(settings.data.cavd_confirmed)
        setListings((open.data || []) as PublicListing[])
        setTraits((matchTraits.data || []) as PetMatchTraits[])
        const row = preference.data as AdopterPreferences | null
        let storedDraft: string | null = null
        try { storedDraft = sessionStorage.getItem(matchDraftKey(profileId)) } catch { /* Drafts are a convenience. */ }
        const draft = parseMatchDraft(storedDraft, row?.updated_at)
        if (draft) setAnswers(draft)
        else if (row) {
          setAnswers({
            preferred_species: row.preferred_species, preferred_size: row.preferred_size,
            preferred_age: row.preferred_age, activity_preference: row.activity_preference,
            temperament_preference: row.temperament_preference, living_space: row.living_space,
            time_availability: row.time_availability, children_at_home: row.children_at_home,
            other_pets_at_home: row.other_pets_at_home, ownership_experience: row.ownership_experience
          })
          setShowResults(true)
        }
      }
      setLoading(false)
    })()
    return () => { current = false }
  }, [profileId])

  function update<K extends keyof Answers>(key: K, value: Answers[K]) {
    const next = { ...answers, [key]: value }
    setAnswers(next)
    if (profileId) try {
      sessionStorage.setItem(matchDraftKey(profileId), JSON.stringify({ answers: next, saved_at: new Date().toISOString() }))
    } catch { /* Drafts are a convenience; the form keeps working without storage. */ }
    setShowResults(false)
    setSkipped(new Set()); setSkipNotice('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId) return
    setBusy(true)
    setError(null)
    setSkipped(new Set()); setSkipNotice('')
    const { error: saveError } = await supabase.from('adopter_preferences')
      .upsert({ user_id: profileId, ...answers }, { onConflict: 'user_id' })
    setBusy(false)
    if (saveError) setError(explain(saveError))
    else {
      try { sessionStorage.removeItem(matchDraftKey(profileId)) } catch { /* Nothing to clear. */ }
      setShowResults(true)
    }
  }

  // A person is never matched with their own pet.
  const candidates = listings.filter(listing => !myPetIds?.has(listing.pet_id))
  const matches = showResults && profileId
    ? rankListings(candidates, traits, { ...answers, user_id: profileId }, new Date(), weights) : []
  const reviewedPetIds = new Set(traits.map(trait => trait.pet_id))
  const unscored = candidates.filter(listing => !reviewedPetIds.has(listing.pet_id)).length
  const outsidePreferences = candidates.length - unscored - matches.length
  const visibleMatches = matches.filter(match => !skipped.has(match.listing.listing_id))

  return <UserShell>
    <div className="page-head">
      <Link className="record-link" to="/app/bridge">← Adoption</Link>
      <h1>Find My Pet Match</h1>
      <p className="sub">Find CAVD-approved pets that fit your preferences and household. Apply from a match; CAVD makes adoption decisions.</p>
    </div>
    {loading ? <p role="status">Loading your preferences and available pets…</p> : null}
    {error ? <Notice kind="bad">Matching is unavailable: {error}.</Notice> : null}
    {!loading && !error ? <>
      <form className="card match-form" onSubmit={event => void submit(event)}>
        <div className="page-head"><h2>Your preferences</h2>
          <p className="sub">Pets are ranked by how closely they fit your answers, weighted by CAVD. Only a pet of a different animal type is left out; comfort with children and other pets is scored with the other criteria. “No preference” accepts any value for that field.</p>
          <p className="sub">{weightsConfirmed ? `CAVD-reviewed weights, version ${weightVersion}.` : 'Default equal weights; CAVD weight review is pending.'} The score helps you compare pets; CAVD makes every adoption decision.</p>
        </div>
        <div className="match-dropdown-grid">
          <Field label="Preferred animal type"><select name="preferred_species" value={answers.preferred_species} onChange={event => update('preferred_species', event.target.value as Answers['preferred_species'])}>
            <option value="any">No preference</option><option value="dog">Dog</option><option value="cat">Cat</option>
          </select></Field>
          <Field label="Children in your home?"><select name="children_at_home" value={String(answers.children_at_home)} onChange={event => update('children_at_home', event.target.value === 'true')}>
            <option value="false">No</option><option value="true">Yes</option>
          </select></Field>
          <Field label="Pet coexistence" hint="Do other pets live in your home?"><select name="other_pets_at_home" value={String(answers.other_pets_at_home)} onChange={event => update('other_pets_at_home', event.target.value === 'true')}>
            <option value="false">No</option><option value="true">Yes</option>
          </select></Field>
        </div>
        <div className="match-question-grid">
          <PreferenceSlider name="preferred_size" label="Preferred size" value={SIZE_VALUES.indexOf(answers.preferred_size)} labels={SIZE_LABELS} onChange={index => update('preferred_size', SIZE_VALUES[index])} />
          <PreferenceSlider name="preferred_age" label="Preferred age" value={AGE_VALUES.indexOf(answers.preferred_age)} labels={AGE_LABELS} onChange={index => update('preferred_age', AGE_VALUES[index])} />
          <RatingField name="activity_preference" label="Your preferred activity level" value={answers.activity_preference} labels={LEVEL_LABELS} onChange={value => update('activity_preference', value)} />
          <PreferenceSlider name="temperament_preference" label="Preferred temperament" value={TEMPERAMENT_VALUES.indexOf(answers.temperament_preference)} labels={TEMPERAMENT_LABELS} onChange={index => update('temperament_preference', TEMPERAMENT_VALUES[index])} />
          <RatingField name="living_space" label="Living-space capacity" value={answers.living_space} labels={SPACE_LABELS} onChange={value => update('living_space', value)} />
          <RatingField name="time_availability" label="Time available for daily care" value={answers.time_availability} labels={LEVEL_LABELS} onChange={value => update('time_availability', value)} />
          <RatingField name="ownership_experience" label="Pet ownership experience" value={answers.ownership_experience} labels={EXPERIENCE_LABELS} onChange={value => update('ownership_experience', value)} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving preferences…' : 'See my matches'}</button>
      </form>
      {showResults ? <section id="match-results" className="adoption-section">
        <div className="page-head"><h2>Compatible pets</h2><p className="sub">{visibleMatches.length} shown · {matches.length} pet{matches.length === 1 ? '' : 's'} ranked by compatibility. All passed CAVD’s adoption checks.</p></div>
        <p className="sr-only" role="status">{skipNotice}</p>
        {skipped.size ? <div className="btn-row pagination-row"><span className="sub">{skipped.size} skipped in this view.</span><button className="btn btn-sm btn-outline" type="button" onClick={() => { setSkipped(new Set()); setSkipNotice('All skipped matches restored.') }}>Restore skipped pets</button></div> : null}
        {saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
        {visibleMatches.length ? <div className="match-results">{visibleMatches.map((match, index) => {
          const considerations = (Object.keys(MATCH_WEIGHTS) as MatchCriterion[])
            .filter(key => match.breakdown[key] < 0.75)
            .map(key => CRITERION_LABELS[key])
          return <article className="match-result" key={match.listing.listing_id}>
            <div className="match-result-photo"><Photo url={match.listing.photo_url} name={match.listing.name} /></div>
            <div className="match-result-copy">
              <span className="step-label">#{index + 1} match · {speciesLabel(match.listing.species)} · {ageLabel(match.listing.birth_date)}</span>
              <h3>{match.listing.name}</h3>
              <div className="pet-tags"><PetCode code={match.listing.qr_slug} compact />{originBadge(match.listing.custody_source)}</div>
              <p>{match.listing.about || match.listing.listing_notes || 'Open for adoption.'}</p>
              <p className="sub">{considerations.length ? `Discuss with CAVD: ${considerations.join(', ')}.` : 'All recorded traits fit your answers.'}</p>
              <details className="match-breakdown"><summary>Why this score?</summary><dl>{(Object.keys(weights) as MatchCriterion[]).map(key => <div key={key}><dt>{CRITERION_LABELS[key]}</dt><dd>{(match.breakdown[key] * 100).toFixed(0)}% fit · {(weights[key] * 100).toFixed(1)}% weight</dd></div>)}</dl></details>
              <div className="btn-row">
                <Link className="btn btn-sm" to={`/app/listings/${match.listing.listing_id}`}>Meet {match.listing.name}</Link>
                {myPetIds ? <Link className="btn btn-sm btn-outline" to={`/app/listings/${match.listing.listing_id}/apply?source=match`}>Apply from this match</Link> : null}
                <SaveListingButton saved={saved.ids?.has(match.listing.listing_id) ?? false} disabled={!saved.ids}
                  busy={saved.busyId === match.listing.listing_id} onToggle={() => void saved.toggle(match.listing.listing_id)} />
              </div>
              <button className="record-link skip-match" type="button" aria-label={`Skip ${match.listing.name} in these results`} onClick={() => { setSkipped(previous => new Set(previous).add(match.listing.listing_id)); setSkipNotice(`${match.listing.name} skipped. Use Restore skipped pets to show it again.`) }}>Skip this pet</button>
            </div>
            <div className="match-score"><strong>{match.score.toFixed(1)}%</strong><span>compatibility</span></div>
          </article>
        })}</div> : <Empty>{matches.length ? 'You have skipped all current matches. Restore skipped pets to see them again.' : outsidePreferences > 0 ? 'No eligible pet matches your preferred animal type. Try another animal type, or browse all adoption pets.' : 'No eligible pets with reviewed matching traits are available yet.'}</Empty>}
        {outsidePreferences > 0 ? <p className="sub">{outsidePreferences} eligible pet{outsidePreferences === 1 ? ' is' : 's are'} a different animal type, so {outsidePreferences === 1 ? 'it is' : 'they are'} left out of these matches. <Link to="/app/bridge">Browse adoption pets</Link>.</p> : null}
        {unscored > 0 ? <p className="sub">{unscored} other approved pet{unscored === 1 ? '' : 's'} can be browsed, but need CAVD-reviewed traits before receiving a score. <Link to="/app/bridge">Browse all pets</Link>.</p> : null}
      </section> : null}
    </> : null}
  </UserShell>
}

export function UserSaved() {
  const { profile } = useAuth()
  const saved = useSavedListings(profile?.id)
  const myPetIds = useMyPetIds(profile?.id)
  const [listings, setListings] = useState<PublicListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('public_listings').select('*').order('listed_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(explain(loadError))
        else setListings((data || []) as PublicListing[])
        setLoading(false)
      })
  }, [])

  const shown = listings.filter(listing => saved.ids?.has(listing.listing_id))
  const noLongerOpen = (saved.ids?.size || 0) - shown.length
  return <UserShell>
    <div className="page-head"><Link className="record-link" to="/app/bridge">← Adoption</Link><h1>Saved pets</h1>
      <p className="sub">Keep a shortlist of approved pets while you decide. Saving a pet does not submit an adoption application.</p></div>
    {loading || !saved.ids && !saved.error ? <CardSkeletons count={3} label="Loading saved pets…" /> : null}
    {error || saved.error ? <Notice kind="bad">Could not load saved pets: {error || saved.error}</Notice> : null}
    {!loading && saved.ids && !error ? <>
      {shown.length ? <div className="pet-grid">{shown.map(row => <ListingCard key={row.listing_id} row={row} href={'/app/listings/' + row.listing_id}
        actions={<>{myPetIds?.has(row.pet_id) ? <Pill kind="owner">Your pet</Pill> : null}<SaveListingButton saved busy={saved.busyId === row.listing_id}
          onToggle={() => void saved.toggle(row.listing_id)} /></>} />)}</div>
        : <Empty>No open pets saved yet. <Link to="/app/bridge">Explore pets</Link> or <Link to="/app/match">find your pet match</Link>.</Empty>}
      {noLongerOpen > 0 ? <p className="sub">{noLongerOpen} saved listing{noLongerOpen === 1 ? '' : 's'} are no longer open and are hidden here.</p> : null}
    </> : null}
  </UserShell>
}
