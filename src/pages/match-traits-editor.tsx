import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { explain, supabase } from '../lib/supabase'
import type { PetMatchTraits } from '../lib/types'
import { Field, Notice } from '../ui'

const ratings = [1, 2, 3, 4, 5]

function Rating({ name, label, value }: { name: string; label: string; value?: number }) {
  return <Field label={label}><select name={name} defaultValue={value ?? ''} required>
    <option value="" disabled>Choose a level</option>
    {ratings.map(number => <option key={number} value={number}>{number}</option>)}
  </select></Field>
}

export function MatchTraitsEditor({ petId, onSaved }: { petId: string; onSaved: (message: string) => void }) {
  const { profile } = useAuth()
  const [traits, setTraits] = useState<PetMatchTraits | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    supabase.from('pet_match_traits').select('*').eq('pet_id', petId).maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!current) return
        if (loadError) setError(explain(loadError))
        else setTraits(data as PetMatchTraits | null)
        setLoading(false)
      })
    return () => { current = false }
  }, [petId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const fields = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const { data, error: saveError } = await supabase.from('pet_match_traits').upsert({
      pet_id: petId,
      activity_level: Number(fields.get('activity_level')),
      temperament: fields.get('temperament'),
      child_compatible: fields.get('child_compatible') === 'true',
      pet_compatible: fields.get('pet_compatible') === 'true',
      space_need: Number(fields.get('space_need')),
      time_need: Number(fields.get('time_need')),
      experience_need: Number(fields.get('experience_need')),
      updated_by: profile.id
    }, { onConflict: 'pet_id' }).select('*').single()
    setBusy(false)
    if (saveError) setError(explain(saveError))
    else { setTraits(data as PetMatchTraits); onSaved('Matching traits saved for adopters.') }
  }

  return <div className="card">
    <h2>Adopter matching traits</h2>
    <p className="sub">Record observed behavior and care needs. A pet needs these traits to receive a match score. Only CAVD staff can edit them.</p>
    {loading ? <p role="status">Loading traits…</p> : null}
    {error ? <Notice kind="bad">{error}</Notice> : null}
    {!loading ? <form key={traits?.updated_at || 'new'} onSubmit={event => void save(event)}>
      <div className="match-question-grid">
        <Rating name="activity_level" label="Activity level · 1 low, 5 high" value={traits?.activity_level} />
        <Field label="Temperament"><select name="temperament" defaultValue={traits?.temperament || ''} required>
          <option value="" disabled>Choose temperament</option>
          <option value="calm">Calm</option><option value="friendly">Friendly</option><option value="playful">Playful</option>
          <option value="independent">Independent</option><option value="protective">Protective</option>
        </select></Field>
        <Field label="Comfortable with children?"><select name="child_compatible" defaultValue={traits ? String(traits.child_compatible) : ''} required>
          <option value="" disabled>Choose one</option><option value="true">Yes</option><option value="false">No</option>
        </select></Field>
        <Field label="Comfortable with other pets?"><select name="pet_compatible" defaultValue={traits ? String(traits.pet_compatible) : ''} required>
          <option value="" disabled>Choose one</option><option value="true">Yes</option><option value="false">No</option>
        </select></Field>
        <Rating name="space_need" label="Space need · 1 low, 5 high" value={traits?.space_need} />
        <Rating name="time_need" label="Daily care time · 1 low, 5 high" value={traits?.time_need} />
        <Rating name="experience_need" label="Experience need · 1 low, 5 high" value={traits?.experience_need} />
      </div>
      <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save matching traits'}</button>
    </form> : null}
  </div>
}
