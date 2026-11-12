import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useMyPetIds } from '../lib/my-pets'
import { useListingApplications } from '../lib/listing-applications'
import { applicationActionLabel, applicationPath } from '../lib/adoption-application'
import { supabase } from '../lib/supabase'
import { assetUrl } from '../lib/format'
import type { PublicListing } from '../lib/types'
import { CardSkeletons, ListingCard, Notice, Pill } from '../ui'

const whoRabies = 'https://www.who.int/health-topics/rabies/'
const cdcDogs = 'https://www.cdc.gov/healthy-pets/about/dogs.html'

export function EducationHome({ publicView = false }: { publicView?: boolean } = {}) {
  const { profile } = useAuth()
  const requests = useListingApplications(publicView ? undefined : profile?.id)
  const ownedPetIds = useMyPetIds(publicView ? undefined : profile?.id)
  const [featured, setFeatured] = useState<PublicListing[]>([])
  const [featuredState, setFeaturedState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (publicView) return
    supabase.from('public_listings').select('*').order('listed_at', { ascending: false }).limit(3)
      .then(({ data, error }) => {
        if (error) setFeaturedState('error')
        else { setFeatured((data || []) as PublicListing[]); setFeaturedState('ready') }
      })
  }, [publicView])

  return <>
    {!publicView ? <section className="education-hero" aria-labelledby="education-title">
      <div>
        <span className="step-label">Learn together. Care together.</span>
        <h1 id="education-title">Small steps.<br />Healthier pets and communities.</h1>
        <p>Your guide to responsible pet care, safer interactions, and rabies awareness in Butuan City.</p>
        <div className="btn-row">
          <Link className="btn" to="/app/match">Find My Match <span aria-hidden="true">→</span></Link>
          <Link className="btn btn-outline" to="/app/bridge">Browse pets</Link>
        </div>
      </div>
      <div className="education-hero-photo"><img src={assetUrl('/home-hero-pets.webp')} alt="Three puspins sleeping together" width="1122" height="1402" /></div>
    </section> : null}

    <aside className="bite-help" aria-labelledby="bite-help-title">
      <div><h2 id="bite-help-title">Bitten or scratched?</h2><p>Wash the wound with soap and running water for at least 15 minutes. Seek medical care immediately at an animal bite treatment center or health facility.</p></div>
      <a href={whoRabies} target="_blank" rel="noreferrer">Read WHO guidance ↗</a>
    </aside>

    {!publicView ? <section className="education-section adoption-feature" aria-labelledby="adoption-feature-title">
      <div className="adoption-feature-head">
        <div><span className="step-label">Adoption and rehoming</span><h2 id="adoption-feature-title">Open for adoption</h2><p className="sub">Pets recently approved by CAVD.</p></div>
        <Link className="btn" to="/app/bridge">Browse available pets →</Link>
      </div>
      {requests.error ? <Notice kind="bad">{requests.error}</Notice> : null}
      {featuredState === 'loading' ? <CardSkeletons count={3} label="Loading available pets…" />
        : featuredState === 'error' ? <Notice kind="bad">Available pets could not be loaded. <Link to="/app/bridge">Open adoption</Link> to try again.</Notice>
        : featured.length ? <div className="pet-grid">{featured.map(row => <ListingCard key={row.listing_id} row={row} href={'/app/listings/' + row.listing_id}
          actions={ownedPetIds?.has(row.pet_id) ? <Pill kind="owner">Your pet</Pill>
            : !requests.applications || !ownedPetIds
            ? <button className="btn btn-sm" type="button" disabled>Loading application…</button>
            : <Link className="btn btn-sm" to={applicationPath(row.listing_id, requests.applications.get(row.listing_id))}>{applicationActionLabel(requests.applications.get(row.listing_id))}</Link>} />)}</div>
        : <div className="adoption-empty"><p>No pets are open for adoption yet. CAVD publishes listings after review.</p><Link to="/app/bridge">Go to Adoption →</Link></div>}
    </section> : null}

    <section id="care-guides" className="education-section" aria-labelledby="care-guides-title">
      <div className="page-head"><span className="step-label">Digital education</span><h2 id="care-guides-title">A little learning goes a long way</h2><p className="sub">Open a guide for practical steps you can share with your household.</p></div>
      <div className="education-grid">
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/rabies-care.webp')} alt="A veterinarian checks a dog during a pet health screening in Legazpi" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">01 · Prevention</span><h3>Understand rabies</h3><span className="sub">Protect pets and people through awareness and timely care.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Talk to your vet about rabies vaccination and keep your pet’s vaccination record current.</li><li>After a bite or scratch, wash the wound immediately and seek medical assessment. Do not wait for symptoms.</li><li>A pet’s public record can provide information, but it cannot replace a health professional’s assessment.</li></ul><a href={whoRabies} target="_blank" rel="noreferrer">Source: World Health Organization ↗</a></div>
        </details>
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/safe-dogs.webp')} alt="A girl gently holding a leashed dog" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">02 · Everyday safety</span><h3>Safer time around dogs</h3><span className="sub">Help children and adults recognize when to give a dog space.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Ask the owner before approaching or touching their dog.</li><li>Give dogs space when they are eating, sleeping, or caring for puppies.</li><li>Always supervise young children around dogs, including familiar family pets.</li></ul><a href={cdcDogs} target="_blank" rel="noreferrer">Source: CDC · Healthy Pets, Healthy People ↗</a></div>
        </details>
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/daily-care.webp')} alt="Two street cats eating" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">03 · Responsible care</span><h3>Build a caring routine</h3><span className="sub">Make room for your companion’s daily and long term needs.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Ask your vet about suitable food, exercise, preventive care, and the environment your pet needs.</li><li>Before adopting, plan who will handle daily care, veterinary visits, and time together.</li><li>Keep your contact details and pet records up to date in PawsLink.</li></ul><Link to={publicView ? '/register' : '/app/profile'}>{publicView ? 'Join PawsLink →' : 'Visit My profile →'}</Link><p className="hint"><a href={cdcDogs} target="_blank" rel="noreferrer">Pet care reference: CDC ↗</a></p></div>
        </details>
      </div>
    </section>

  </>
}
