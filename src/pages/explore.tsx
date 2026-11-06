import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { eligibilitySetupMessage } from '../lib/eligibility'
import { useAuth } from '../lib/auth'
import { useMyPetIds } from '../lib/my-pets'
import { explain, supabase } from '../lib/supabase'
import type { PublicListing } from '../lib/types'
import { ageGroup, ageMonths } from '../lib/format'
import { CardSkeletons, Empty, Field, ListingCard, Notice, Pill } from '../ui'
import { PublicFrame } from './public'

export function ExplorePets() {
  const { profile } = useAuth()
  const myPetIds = useMyPetIds(profile?.id)
  const [pets, setPets] = useState<PublicListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [species, setSpecies] = useState('any')
  const [size, setSize] = useState('any')
  const [age, setAge] = useState('any')
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(0)
  useEffect(() => {
    let active = true
    void (async () => {
      const setup = await supabase.from('public_match_weights').select('version').single()
      if (setup.error) throw new Error(eligibilitySetupMessage)
      const rows: PublicListing[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error: loadError } = await supabase.from('public_listings').select('*')
          .order('listed_at', { ascending: false }).order('listing_id').range(offset, offset + 499)
        if (loadError) throw loadError
        rows.push(...(data || []) as PublicListing[])
        if (!data || data.length < 500) break
      }
      if (active) { setPets(rows); setLoading(false) }
    })().catch(cause => { if (active) { setError(explain(cause)); setLoading(false) } })
    return () => { active = false }
  }, [])
  const shown = pets.filter(pet => (species === 'any' || pet.species === species) && (size === 'any' || pet.size === size) &&
    (age === 'any' || ageGroup(pet.birth_date) === age) &&
    `${pet.name} ${pet.breed || ''} ${pet.qr_slug}`.toLowerCase().includes(query.trim().toLowerCase()))
  // Rows arrive newest first; "Featured" keeps that order but leads with pets that have a photo.
  if (sort === 'recommended') shown.sort((a, b) => Number(!a.photo_url) - Number(!b.photo_url))
  else if (sort === 'youngest') shown.sort((a, b) => ageMonths(a.birth_date) - ageMonths(b.birth_date))
  else if (sort === 'oldest') shown.sort((a, b) => ageMonths(b.birth_date) - ageMonths(a.birth_date))
  else if (sort === 'name') shown.sort((a, b) => a.name.localeCompare(b.name))
  const activePage = Math.min(page, Math.max(0, Math.ceil(shown.length / 12) - 1))
  return <PublicFrame>
    <div className="page-head"><h1>Explore pets</h1><p className="sub">Meet pets that pass CAVD’s adoption readiness checks. Browse freely, then sign in to apply. Preference matching is optional.</p></div>
    <form className="filters" onSubmit={event => event.preventDefault()}>
      <Field label="Name, breed or PET ID"><input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></Field>
      <Field label="Species"><select value={species} onChange={event => { setSpecies(event.target.value); setPage(0) }}><option value="any">Any species</option><option value="dog">Dogs</option><option value="cat">Cats</option><option value="other">Other</option></select></Field>
      <Field label="Size"><select value={size} onChange={event => { setSize(event.target.value); setPage(0) }}><option value="any">Any size</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></Field>
      <Field label="Age"><select value={age} onChange={event => { setAge(event.target.value); setPage(0) }}><option value="any">Any age</option><option value="baby">Under 1 year</option><option value="young">1–3 years</option><option value="adult">3–7 years</option><option value="senior">7+ years</option></select></Field>
      <Field label="Sort by"><select value={sort} onChange={event => { setSort(event.target.value); setPage(0) }}><option value="recommended">Featured</option><option value="newest">Newest listed</option><option value="youngest">Youngest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option></select></Field>
    </form>
    {loading ? <CardSkeletons label="Loading eligible pets…" /> : error ? <Notice kind="bad">{error}</Notice> : <>
      <p className="sub">{shown.length} pet{shown.length === 1 ? '' : 's'} available. Current vaccination, completed spay/neuter, behavioral clearance, and CAVD review are required.</p>
      {shown.length ? <div className="pet-grid">{shown.slice(activePage * 12, activePage * 12 + 12).map(pet => <ListingCard key={pet.listing_id} row={pet} href={`/p/${pet.qr_slug}`}
        actions={myPetIds?.has(pet.pet_id) ? <Pill kind="owner">Your pet</Pill> : myPetIds ? <Link className="btn btn-sm" to={`/app/listings/${pet.listing_id}`}>Adoption options</Link> : <></>} />)}</div> : <Empty>No eligible pets match this view. Check again after CAVD completes its reviews.</Empty>}
      {shown.length > 12 ? <div className="btn-row pagination-row"><button className="btn btn-sm btn-outline" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous</button><span>Page {activePage + 1} of {Math.ceil(shown.length / 12)}</span><button className="btn btn-sm btn-outline" disabled={(activePage + 1) * 12 >= shown.length} onClick={() => setPage(activePage + 1)}>Next</button></div> : null}
    </>}
  </PublicFrame>
}
