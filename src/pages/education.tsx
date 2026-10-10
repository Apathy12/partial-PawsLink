import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { assetUrl } from '../lib/format'
import type { PublicListing } from '../lib/types'
import { ListingCard, Notice } from '../ui'

const whoRabies = 'https://www.who.int/health-topics/rabies/'
const cdcDogs = 'https://www.cdc.gov/healthy-pets/about/dogs.html'

const questions = [
  {
    question: 'A dog is eating. What is the safest choice?',
    choices: ['Reach for its bowl', 'Give it space and wait', 'Hug it while it eats'],
    answer: 1,
    explanation: 'Leave dogs undisturbed while eating, sleeping, or caring for puppies. Supervise children around dogs.'
  },
  {
    question: 'You have been bitten or scratched by an animal. What should you do?',
    choices: ['Wait to see if symptoms appear', 'Only check the animal’s QR tag', 'Wash with soap and running water for at least 15 minutes and seek medical care immediately'],
    answer: 2,
    explanation: 'Washing is immediate first aid. A health professional must assess the exposure and any treatment needed; do not wait for symptoms.'
  },
  {
    question: 'How can you help protect your pet and your community?',
    choices: ['Keep veterinary care and vaccination records current', 'Let your pet roam to meet other animals', 'Assume a healthy-looking animal cannot spread infection'],
    answer: 0,
    explanation: 'Discuss preventive care and vaccination with your vet, and keep a record of each visit.'
  }
]

export function EducationHome({ publicView = false }: { publicView?: boolean } = {}) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [featured, setFeatured] = useState<PublicListing[]>([])
  const [featuredState, setFeaturedState] = useState<'loading' | 'ready' | 'error'>('loading')
  const answered = Object.keys(answers).length
  const correct = questions.filter((q, i) => answers[i] === q.answer).length
  const currentQuestion = questions[questionIndex]
  const currentAnswer = answers[questionIndex]

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
          <a className="btn" href="#care-guides">Explore the guides</a>
          <a className="btn btn-outline" href="#knowledge-check">Try a quick check</a>
        </div>
      </div>
      <div className="education-hero-photo"><img src={assetUrl('/home-hero-pets.webp')} alt="Two cats and two dogs playing together in a garden" width="1122" height="1402" /></div>
    </section> : null}

    <aside className="bite-help" aria-labelledby="bite-help-title">
      <div><h2 id="bite-help-title">Bitten or scratched?</h2><p>Wash the wound with soap and running water for at least 15 minutes. Seek medical care immediately at an animal bite treatment center or health facility.</p></div>
      <a href={whoRabies} target="_blank" rel="noreferrer">Read WHO guidance ↗</a>
    </aside>

    {!publicView ? <section className="education-section adoption-feature" aria-labelledby="adoption-feature-title">
      <div className="adoption-feature-head">
        <div><span className="step-label">Adoption and rehoming</span><h2 id="adoption-feature-title">Open for adoption</h2><p className="sub">Browse pets approved by CAVD. Find My Pet Match is the way to start an application.</p></div>
        <Link className="btn" to="/app/bridge">Browse available pets →</Link>
      </div>
      {featuredState === 'loading' ? <p className="sub" role="status">Loading available pets…</p>
        : featuredState === 'error' ? <Notice kind="bad">Available pets could not be loaded. <Link to="/app/bridge">Open adoption</Link> to try again.</Notice>
        : featured.length ? <div className="pet-grid">{featured.map(row => <ListingCard key={row.listing_id} row={row} href={'/app/listings/' + row.listing_id} />)}</div>
        : <div className="adoption-empty"><p>No pets are open for adoption yet. CAVD publishes listings after review.</p><Link to="/app/bridge">How adoption works →</Link></div>}
    </section> : null}

    <section id="care-guides" className="education-section" aria-labelledby="care-guides-title">
      <div className="page-head"><span className="step-label">Digital education</span><h2 id="care-guides-title">A little learning goes a long way</h2><p className="sub">Open a guide for practical steps you can share with your household.</p></div>
      <div className="education-grid">
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/rabies-care.webp')} alt="A veterinarian checks a dog with its owner present" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">01 · Prevention</span><h3>Understand rabies</h3><span className="sub">Protect pets and people through awareness and timely care.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Talk to your vet about rabies vaccination and keep your pet’s vaccination record current.</li><li>After a bite or scratch, wash the wound immediately and seek medical assessment. Do not wait for symptoms.</li><li>A pet’s QR record can provide information, but it cannot replace a health professional’s assessment.</li></ul><a href={whoRabies} target="_blank" rel="noreferrer">Source: World Health Organization ↗</a></div>
        </details>
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/safe-dogs.webp')} alt="An adult supervises a child giving a resting dog space" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">02 · Everyday safety</span><h3>Safer time around dogs</h3><span className="sub">Help children and adults recognize when to give a dog space.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Ask the owner before approaching or touching their dog.</li><li>Give dogs space when they are eating, sleeping, or caring for puppies.</li><li>Always supervise young children around dogs, including familiar family pets.</li></ul><a href={cdcDogs} target="_blank" rel="noreferrer">Source: CDC · Healthy Pets, Healthy People ↗</a></div>
        </details>
        <details className="lesson-card">
          <summary><img className="lesson-photo" src={assetUrl('/education/daily-care.webp')} alt="A pet owner prepares food and water for a dog at home" loading="lazy" width="1536" height="1024" /><span className="lesson-card-copy"><span className="lesson-number">03 · Responsible care</span><h3>Build a caring routine</h3><span className="sub">Make room for your companion’s daily and long term needs.</span><span className="lesson-toggle">Read guide <span aria-hidden="true">＋</span></span></span></summary>
          <div className="lesson-content"><ul><li>Ask your vet about suitable food, exercise, preventive care, and the environment your pet needs.</li><li>Before adopting, plan who will handle daily care, veterinary visits, and time together.</li><li>Keep your contact details and pet records up to date in PawsLink.</li></ul><Link to={publicView ? '/register' : '/app/profile'}>{publicView ? 'Join PawsLink →' : 'Visit My profile →'}</Link><p className="hint"><a href={cdcDogs} target="_blank" rel="noreferrer">Pet care reference: CDC ↗</a></p></div>
        </details>
      </div>
    </section>

    <section id="knowledge-check" className="education-section knowledge-check" aria-labelledby="knowledge-title">
      <div className="page-head"><span className="step-label">Put learning into practice</span><h2 id="knowledge-title">What would you do?</h2><p className="sub">Choose an answer to see a helpful explanation. This is for learning and does not affect your account or adoption applications.</p></div>
      <div className="quiz-progress" aria-live="polite">Question {questionIndex + 1} of {questions.length}{answered === questions.length ? ` · ${correct} correct` : ''}</div>
      <fieldset className="quiz-question" key={currentQuestion.question}>
        <legend>{currentQuestion.question}</legend>
        <div className="quiz-choices">{currentQuestion.choices.map((choice, index) => <label key={choice} className={'quiz-choice' + (currentAnswer === index ? ' selected' : '')}>
          <input type="radio" name={`question-${questionIndex}`} checked={currentAnswer === index} onChange={() => setAnswers(a => ({ ...a, [questionIndex]: index }))} />
          <span>{choice}</span>
        </label>)}</div>
        <div aria-live="polite">{currentAnswer !== undefined ? <Notice kind={currentAnswer === currentQuestion.answer ? 'ok' : 'info'}><strong>{currentAnswer === currentQuestion.answer ? 'That’s right. ' : 'Let’s learn together. '}</strong>{currentQuestion.explanation}</Notice> : null}</div>
      </fieldset>
      <div className="quiz-actions">
        {questionIndex > 0 ? <button type="button" className="btn btn-outline" onClick={() => setQuestionIndex(i => i - 1)}>Previous</button> : null}
        {questionIndex < questions.length - 1 ? <button type="button" className="btn" onClick={() => setQuestionIndex(i => i + 1)} disabled={currentAnswer === undefined}>Next question →</button> : null}
        {answered === questions.length ? <button type="button" className="btn btn-outline" onClick={() => { setAnswers({}); setQuestionIndex(0) }}>Try again</button> : null}
      </div>
      <p className="hint">Based on <a href={whoRabies} target="_blank" rel="noreferrer">WHO rabies guidance</a> and <a href={cdcDogs} target="_blank" rel="noreferrer">CDC dog safety guidance</a>.</p>
    </section>

    <section className="education-section" aria-labelledby="community-title">
      <div className="page-head"><span className="step-label">Community awareness</span><h2 id="community-title">Care beyond your own doorstep</h2><p className="sub">A few thoughtful actions can help make Ampayon a safer place for pets and people.</p></div>
      <div className="education-grid">
        <article className="card community-card"><h3>Share what you learn</h3><p>Go through the safety guides with your household. Help children practice asking permission and giving animals space.</p><a href="#care-guides">Review the guides →</a></article>
        <article className="card community-card"><h3>Help a found pet</h3><p>If it is safe to approach, scan a PawsLink tag to view the public record. Keep your distance from frightened animals and contact CAVD for help.</p><Link to={publicView ? '/scan' : '/app/scan'}>Scan a pet’s tag →</Link></article>
        <article className="card community-card"><h3>Stay involved locally</h3><p>Check with CAVD or your barangay for confirmed vaccination activities and animal welfare announcements.</p><p className="hint">No community events have been posted in this prototype yet.</p></article>
      </div>
    </section>
  </>
}
