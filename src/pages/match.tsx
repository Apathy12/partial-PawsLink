import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ageLabel, speciesLabel } from '../lib/format'
import { DEMO_MATCH_LISTINGS, DEMO_MATCH_TRAITS } from '../lib/match-demo'
import {
  CRITERION_LABELS, DEFAULT_PREFERENCES, MATCH_WEIGHTS, rankListings,
  type MatchCriterion
} from '../lib/matching'
import { useSavedListings } from '../lib/saved-listings'
import { explain, supabase } from '../lib/supabase'
import type { AdopterPreferences, PetMatchTraits, PublicListing } from '../lib/types'
import { Empty, Field, ListingCard, Notice, Photo, SaveListingButton } from '../ui'
import { UserShell } from './user'

type Answers = Omit<AdopterPreferences, 'user_id' | 'updated_at'>

const levelLabels = ['Very low', 'Low', 'Moderate', 'High', 'Very high']
const spaceLabels = ['Small room', 'Compact home', 'Average home', 'Large home', 'Large home with yard']
const experienceLabels = ['First-time owner', 'Some exposure', 'Some experience', 'Experienced', 'Very experienced']

function RatingField({ label, value, labels, onChange }: {
  label: string; value: number; labels: string[]; onChange: (value: number) => void
}) {
  return <Field label={label}><select value={value} onChange={event => onChange(Number(event.target.value))}>
    {labels.map((text, index) => <option key={text} value={index + 1}>{index + 1} — {text}</option>)}
  </select></Field>
}

export function UserMatch() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const saved = useSavedListings(profileId)
  const [answers, setAnswers] = useState<Answers>(DEFAULT_PREFERENCES)
  const [listings, setListings] = useState<PublicListing[]>([])
  const [traits, setTraits] = useState<PetMatchTraits[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    if (!profileId) return
    let current = true
    ;(async () => {
      const [preference, open, matchTraits] = await Promise.all([
        supabase.from('adopter_preferences').select('*').eq('user_id', profileId).maybeSingle(),
        supabase.from('public_listings').select('*').order('listed_at', { ascending: false }),
        supabase.from('pet_match_traits').select('*')
      ])
      if (!current) return
      const failure = preference.error || open.error || matchTraits.error
      if (failure && /Could not find the table 'public\.(adopter_preferences|pet_match_traits)'/i.test(failure.message)) {
        setDemoMode(true)
        setListings(DEMO_MATCH_LISTINGS)
        setTraits(DEMO_MATCH_TRAITS)
      } else if (failure) setError(explain(failure))
      else {
        setListings((open.data || []) as PublicListing[])
        setTraits((matchTraits.data || []) as PetMatchTraits[])
        if (preference.data) {
          const row = preference.data as AdopterPreferences
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
    setAnswers(previous => ({ ...previous, [key]: value }))
    setShowResults(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profileId) return
    setBusy(true)
    setError(null)
    if (demoMode) {
      setShowResults(true)
      setBusy(false)
      return
    }
    const { error: saveError } = await supabase.from('adopter_preferences')
      .upsert({ user_id: profileId, ...answers }, { onConflict: 'user_id' })
    setBusy(false)
    if (saveError) setError(explain(saveError))
    else setShowResults(true)
  }

  const matches = showResults && profileId
    ? rankListings(listings, traits, { ...answers, user_id: profileId }) : []
  const unscored = listings.length - matches.length

  return <UserShell>
    <div className="page-head">
      <Link className="record-link" to="/app/bridge">← Adoption</Link>
      <h1>Find My Pet Match</h1>
      <p className="sub">Tell us about the pet and home you have in mind. We rank open listings approved by CAVD. Apply from a ranked match; CAVD makes adoption decisions.</p>
    </div>
    {loading ? <p role="status">Loading your preferences and available pets…</p> : null}
    {demoMode ? <Notice kind="info">Sample preview: try the questionnaire with five demo pets. Saving pets and applying to them will be available after the project database is set up.</Notice> : null}
    {error ? <Notice kind="bad">Matching is unavailable: {error}.</Notice> : null}
    {!loading && !error ? <>
      <form className="card match-form" onSubmit={event => void submit(event)}>
        <div className="page-head"><h2>Your preferences</h2><p className="sub">The 10 criteria have equal demo weights. You can change your answers and see a new ranking at any time.</p></div>
        <div className="match-question-grid">
          <Field label="Preferred animal type"><select value={answers.preferred_species} onChange={event => update('preferred_species', event.target.value as Answers['preferred_species'])}>
            <option value="any">No preference</option><option value="dog">Dog</option><option value="cat">Cat</option>
          </select></Field>
          <Field label="Preferred size"><select value={answers.preferred_size} onChange={event => update('preferred_size', event.target.value as Answers['preferred_size'])}>
            <option value="any">No preference</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select></Field>
          <Field label="Preferred age"><select value={answers.preferred_age} onChange={event => update('preferred_age', event.target.value as Answers['preferred_age'])}>
            <option value="any">No preference</option><option value="baby">Under 1 year</option><option value="young">1–3 years</option><option value="adult">3–7 years</option><option value="senior">7 years and over</option>
          </select></Field>
          <RatingField label="Your preferred activity level" value={answers.activity_preference} labels={levelLabels} onChange={value => update('activity_preference', value)} />
          <Field label="Preferred temperament"><select value={answers.temperament_preference} onChange={event => update('temperament_preference', event.target.value as Answers['temperament_preference'])}>
            <option value="any">No preference</option><option value="calm">Calm</option><option value="friendly">Friendly</option><option value="playful">Playful</option><option value="independent">Independent</option><option value="protective">Protective</option>
          </select></Field>
          <RatingField label="Living-space capacity" value={answers.living_space} labels={spaceLabels} onChange={value => update('living_space', value)} />
          <RatingField label="Time available for daily care" value={answers.time_availability} labels={levelLabels} onChange={value => update('time_availability', value)} />
          <Field label="Children in your home?"><select value={String(answers.children_at_home)} onChange={event => update('children_at_home', event.target.value === 'true')}>
            <option value="false">No</option><option value="true">Yes</option>
          </select></Field>
          <Field label="Other pets in your home?"><select value={String(answers.other_pets_at_home)} onChange={event => update('other_pets_at_home', event.target.value === 'true')}>
            <option value="false">No</option><option value="true">Yes</option>
          </select></Field>
          <RatingField label="Pet ownership experience" value={answers.ownership_experience} labels={experienceLabels} onChange={value => update('ownership_experience', value)} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving preferences…' : 'See my matches'}</button>
      </form>
      {showResults ? <section id="match-results" className="adoption-section">
        <div className="page-head"><h2>Ranked matches</h2><p className="sub">{matches.length} scored pet{matches.length === 1 ? '' : 's'} from CAVD-approved listings.</p></div>
        {!demoMode && saved.error ? <Notice kind="warn">Saved pets are unavailable: {saved.error}</Notice> : null}
        {matches.length ? <div className="match-results">{matches.map((match, index) => {
          const considerations = (Object.keys(MATCH_WEIGHTS) as MatchCriterion[])
            .filter(key => match.breakdown[key] < 0.75)
            .map(key => CRITERION_LABELS[key])
          return <article className="match-result" key={match.listing.listing_id}>
            <div className="match-result-photo"><Photo url={match.listing.photo_url} name={match.listing.name} /></div>
            <div className="match-result-copy">
              <span className="step-label">#{index + 1} match · {speciesLabel(match.listing.species)} · {ageLabel(match.listing.birth_date)}</span>
              <h3>{match.listing.name}</h3>
              <p>{match.listing.about || match.listing.listing_notes || 'Open for adoption.'}</p>
              <p className="sub">{considerations.length ? `Discuss with CAVD: ${considerations.join(', ')}.` : 'All recorded traits fit your answers.'}</p>
              {!demoMode ? <div className="btn-row">
                <Link className="btn btn-sm" to={`/app/listings/${match.listing.listing_id}`}>Meet {match.listing.name}</Link>
                <Link className="btn btn-sm btn-outline" to={`/app/listings/${match.listing.listing_id}/apply?source=match`}>Apply from this match</Link>
                <SaveListingButton saved={saved.ids?.has(match.listing.listing_id) ?? false} disabled={!saved.ids}
                  busy={saved.busyId === match.listing.listing_id} onToggle={() => void saved.toggle(match.listing.listing_id)} />
              </div> : <span className="sub">Sample pet · no application</span>}
            </div>
            <div className="match-score"><strong>{match.score.toFixed(1)}%</strong><span>compatibility</span></div>
          </article>
        })}</div> : <Empty>No scored pets yet. CAVD can add matching traits to approved listings in the pet registry.</Empty>}
        {unscored > 0 ? <p className="sub">{unscored} other approved pet{unscored === 1 ? '' : 's'} can be browsed, but need CAVD-reviewed traits before receiving a score. <Link to="/app/bridge">Browse all pets</Link>.</p> : null}
      </section> : null}
    </> : null}
  </UserShell>
}

export function UserSaved() {
  const { profile } = useAuth()
  const saved = useSavedListings(profile?.id)
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
    {loading || !saved.ids && !saved.error ? <p role="status">Loading saved pets…</p> : null}
    {error || saved.error ? <Notice kind="bad">Could not load saved pets: {error || saved.error}</Notice> : null}
    {!loading && saved.ids && !error ? <>
      {shown.length ? <div className="pet-grid">{shown.map(row => <ListingCard key={row.listing_id} row={row} href={'/app/listings/' + row.listing_id}
        actions={<SaveListingButton saved busy={saved.busyId === row.listing_id}
          onToggle={() => void saved.toggle(row.listing_id)} />} />)}</div>
        : <Empty>No open pets saved yet. <Link to="/app/bridge">Explore pets</Link> or <Link to="/app/match">find your pet match</Link>.</Empty>}
      {noLongerOpen > 0 ? <p className="sub">{noLongerOpen} saved listing{noLongerOpen === 1 ? '' : 's'} are no longer open and are hidden here.</p> : null}
    </> : null}
  </UserShell>
}
