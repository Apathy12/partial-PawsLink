import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { explain, supabase } from '../lib/supabase'
import { fmtDate, sexLabel, sizeLabel, speciesLabel } from '../lib/format'
import { detailsRequested, ownerAnswered } from '../lib/pet-registry'
import type { Application, ApplicationEvent, Listing, Pet, VerificationRequest, Visit } from '../lib/types'
import { Empty, Notice, Pill } from '../ui'
import { OfficeShell, useCounts } from './office'
import { UserShell } from './user'

type InboxItem = {
  id: string
  kind: 'Registration' | 'Listing' | 'Adoption' | 'Account' | 'Veterinary'
  title: string
  text: string
  date: string
  to: string
  action: string
}
type AppRow = Pick<Application, 'id' | 'adopter_id' | 'pet_name_snapshot' | 'discovery_path' | 'response_date' | 'created_at'>
type VisitRow = Pick<Visit, 'id' | 'pet_id' | 'visit_type' | 'vaccine_name' | 'vaccine_next_due_on' | 'created_at'>
type Named = { id: string; name: string }

// Applications and visits carry long answers and notes, so only these columns are read.
const APP_COLUMNS = 'id, adopter_id, pet_name_snapshot, discovery_path, response_date, created_at'
const VISIT_COLUMNS = 'id, pet_id, visit_type, vaccine_name, vaccine_next_due_on, created_at'
const FILTERS = ['All', 'Adoption', 'Registration', 'Veterinary'] as const
const DAY = 86_400_000
const SEEN = 'pawslink-inbox-seen-'
const newest = { ascending: false }

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query
  if (error) throw error
  return (data || []) as T[]
}

const unique = (ids: (string | null)[]) => [...new Set(ids.filter(Boolean))] as string[]
const brief = (text: string | null) => !text ? '' : text.length > 160 ? text.slice(0, 159).trimEnd() + '…' : text

function eventTitle(event: ApplicationEvent) {
  const step = event.new_status === 'pending' ? event.new_stage : event.new_status
  return step === 'approved' ? 'Application approved'
    : step === 'rejected' ? 'Application declined'
    : step === 'additional_requirements' ? 'CAVD needs more requirements'
    : step === 'for_interview' ? 'CAVD asked for an interview'
    : step === 'under_review' ? 'Application under review'
    : 'Application received'
}

async function userItems(me: string): Promise<InboxItem[]> {
  const [pets, apps, ids] = await Promise.all([
    rows<Pet>(supabase.from('pets').select('*').eq('owner_id', me).order('created_at', newest).limit(50)),
    rows<AppRow>(supabase.from('applications').select(APP_COLUMNS).eq('adopter_id', me).order('created_at', newest).limit(50)),
    rows<VerificationRequest>(supabase.from('verification_requests').select('*').eq('user_id', me).neq('status', 'pending')
      .order('created_at', newest).limit(50))
  ])
  const petIds = pets.map(pet => pet.id)
  const [listings, visits, events] = await Promise.all([
    petIds.length ? rows<Listing>(supabase.from('listings').select('*').in('pet_id', petIds).neq('status', 'pending')
      .order('created_at', newest).limit(50)) : [],
    petIds.length ? rows<VisitRow>(supabase.from('visits').select(VISIT_COLUMNS).in('pet_id', petIds)
      .order('created_at', newest).limit(50)) : [],
    apps.length ? rows<ApplicationEvent>(supabase.from('application_events').select('*').in('application_id', apps.map(app => app.id))
      .order('created_at', newest).limit(50)) : []
  ])
  const petName = (id: string) => pets.find(pet => pet.id === id)?.name || 'your pet'
  return [
    ...pets.filter(detailsRequested).map((pet): InboxItem => ({
      id: 'ask' + pet.id, kind: 'Registration', date: pet.decided_at || pet.updated_at,
      title: `CAVD needs more details for ${pet.name}`, text: brief(pet.registry_note),
      to: '/app/pets/' + pet.id, action: 'Complete details'
    })),
    ...pets.filter(pet => pet.registry_status !== 'pending').map((pet): InboxItem => ({
      id: 'pet' + pet.id, kind: 'Registration', date: pet.decided_at || pet.created_at,
      title: `${pet.name}’s registration was ${pet.registry_status === 'approved' ? 'approved' : 'rejected'}`,
      text: pet.registry_status === 'approved' ? `${pet.name} is now in the city registry.` : brief(pet.registry_note),
      to: '/app/pets/' + pet.id, action: 'Open pet record'
    })),
    ...listings.map((listing): InboxItem => ({
      id: 'listing' + listing.id, kind: 'Listing', date: listing.decided_at || listing.created_at,
      title: listing.status === 'approved' ? 'Listing approved' : listing.status === 'rejected' ? 'Listing rejected' : 'Listing closed',
      text: listing.status === 'approved' ? `${petName(listing.pet_id)} is open for adoption.`
        : brief(listing.decision_note) || `${petName(listing.pet_id)} is not listed for adoption.`,
      to: '/app/pets/' + listing.pet_id, action: 'Open pet record'
    })),
    ...events.map((event): InboxItem => ({
      id: 'event' + event.id, kind: 'Adoption', date: event.created_at, title: eventTitle(event),
      text: `Application for ${apps.find(app => app.id === event.application_id)?.pet_name_snapshot || 'a pet'}`
        + (event.remarks ? ': ' + brief(event.remarks) : '.'),
      to: '/app/applications/' + event.application_id, action: 'View application'
    })),
    ...ids.map((request): InboxItem => ({
      id: 'id' + request.id, kind: 'Account', date: request.reviewed_at || request.created_at,
      title: request.status === 'approved' ? 'Your account is active' : 'Your ID needs to be submitted again',
      text: brief(request.review_note) || (request.status === 'approved' ? 'Your ID was recorded. You can now register pets and apply to adopt.' : ''),
      to: '/app/profile', action: 'My profile'
    })),
    ...visits.map((visit): InboxItem => ({
      id: 'visit' + visit.id, kind: 'Veterinary', date: visit.created_at,
      title: `${visit.visit_type === 'vaccination' ? 'Vaccination' : 'Visit'} recorded for ${petName(visit.pet_id)}`,
      text: [visit.vaccine_name, visit.vaccine_next_due_on ? 'Valid through ' + fmtDate(visit.vaccine_next_due_on) : '']
        .filter(Boolean).join(' · '),
      to: '/app/pets/' + visit.pet_id, action: 'View visit'
    }))
  ]
}

async function officeItems(): Promise<InboxItem[]> {
  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)
  const [pets, listings, apps, ids, due] = await Promise.all([
    rows<Pet>(supabase.from('pets').select('*').eq('registry_status', 'pending').order('created_at', newest).limit(50)),
    rows<Listing>(supabase.from('listings').select('*').eq('status', 'pending').order('created_at', newest).limit(50)),
    rows<AppRow>(supabase.from('applications').select(APP_COLUMNS).eq('status', 'pending').order('created_at', newest).limit(50)),
    rows<VerificationRequest>(supabase.from('verification_requests').select('*').eq('status', 'pending')
      .order('created_at', newest).limit(50)),
    rows<VisitRow>(supabase.from('visits').select(VISIT_COLUMNS).gte('vaccine_next_due_on', today).lte('vaccine_next_due_on', soon)
      .order('vaccine_next_due_on').limit(50))
  ])
  const people = unique([...pets.map(pet => pet.owner_id), ...listings.map(listing => listing.listed_by),
    ...apps.map(app => app.adopter_id), ...ids.map(request => request.user_id)])
  const otherPets = unique([...listings, ...due].map(row => row.pet_id))
  const [profiles, named, renewed] = await Promise.all([
    people.length ? rows<Named>(supabase.from('profiles').select('id, name').in('id', people)) : [],
    otherPets.length ? rows<Named>(supabase.from('pets').select('id, name').in('id', otherPets)) : [],
    due.length ? rows<VisitRow>(supabase.from('visits').select(VISIT_COLUMNS).in('pet_id', unique(due.map(visit => visit.pet_id)))
      .gt('vaccine_next_due_on', soon).limit(200)) : []
  ])
  const who = (id: string | null) => profiles.find(person => person.id === id)?.name || 'Someone'
  const petName = (id: string) => named.find(pet => pet.id === id)?.name || 'A pet'
  const vaccine = (visit: VisitRow) => (visit.vaccine_name || '').trim().toLowerCase()
  return [
    // A registration waiting on its owner returns here once the owner has updated it.
    ...pets.filter(pet => !detailsRequested(pet) || ownerAnswered(pet)).map((pet): InboxItem => ownerAnswered(pet) ? {
      id: 'pet' + pet.id, kind: 'Registration', date: pet.updated_at, title: 'Owner updated pet details',
      text: `${who(pet.owner_id)} updated ${pet.name} after your request.`, to: '/office/registrations', action: 'Review registration'
    } : {
      id: 'pet' + pet.id, kind: 'Registration', date: pet.created_at, title: 'New pet registration',
      text: `${who(pet.owner_id)} registered ${pet.name} · ${speciesLabel(pet.species)} · ${pet.breed || 'Unknown breed'} · ${sexLabel(pet.sex)} · ${sizeLabel(pet.size)}`,
      to: '/office/registrations', action: 'Review registration'
    }),
    ...listings.map((listing): InboxItem => ({
      id: 'listing' + listing.id, kind: 'Listing', date: listing.created_at, title: 'Listing request',
      text: `${who(listing.listed_by)} asked to list ${petName(listing.pet_id)} for adoption.`,
      to: '/office/listings', action: 'Open listing queue'
    })),
    ...apps.map((app): InboxItem => {
      const about = `${app.pet_name_snapshot || 'a pet'} · From ${app.discovery_path === 'match' ? 'Find My Match' : 'Direct Adoption'}`
      // An applicant's answer to CAVD brings the application back to the top.
      return app.response_date ? {
        id: 'app' + app.id, kind: 'Adoption', date: app.response_date, title: 'Applicant replied',
        text: `${who(app.adopter_id)} replied about ${about}`, to: '/office/applications/' + app.id, action: 'Open application'
      } : {
        id: 'app' + app.id, kind: 'Adoption', date: app.created_at, title: 'New adoption application',
        text: `${who(app.adopter_id)} applied for ${about}`, to: '/office/applications/' + app.id, action: 'Review application'
      }
    }),
    ...ids.map((request): InboxItem => ({
      id: 'id' + request.id, kind: 'Account', date: request.created_at, title: 'New ID recorded',
      text: `${who(request.user_id)} uploaded an ID and the account is now active. CAVD can inspect it when reviewing this account's records.`,
      to: '/office/verifications', action: 'View ID'
    })),
    // A due date stops mattering once the same vaccine has a later record for that pet.
    ...due.filter(visit => !renewed.some(later => later.pet_id === visit.pet_id && vaccine(later) === vaccine(visit))).map((visit): InboxItem => ({
      // Dated from the day the reminder started, 30 days before the vaccination is due.
      id: 'visit' + visit.id, kind: 'Veterinary', date: new Date(Date.parse(visit.vaccine_next_due_on!) - 30 * DAY).toISOString(),
      title: 'Vaccination due soon',
      text: `${petName(visit.pet_id)} · ${visit.vaccine_name || 'Vaccination'} is valid through ${fmtDate(visit.vaccine_next_due_on)}.`,
      to: '/office/pets/' + visit.pet_id, action: 'Open pet record'
    }))
  ]
}

// shortcut: read state is per browser; move to a table if it must follow the account across devices
function readSeen(id: string) {
  try { return Date.parse(localStorage.getItem(SEEN + id) || '') || 0 } catch { return 0 }
}
function writeSeen(id: string) {
  try { localStorage.setItem(SEEN + id, new Date().toISOString()) } catch { /* Items stay new in this browser. */ }
}

/** Inbox items, newest first, and how many arrived since the inbox was last read. The shells use it for the bell. */
export function useInbox(scope: 'user' | 'office', enabled = true) {
  const id = useAuth().profile?.id
  const [loaded, setLoaded] = useState<{ items: InboxItem[]; error: string | null } | null>(null)
  const [seen, setSeen] = useState(() => id ? readSeen(id) : 0)
  useEffect(() => {
    if (!id || !enabled) return
    let active = true
    const load = scope === 'user' ? userItems(id) : officeItems()
    load.then(
      items => { if (active) setLoaded({ items: items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), error: null }) },
      cause => { if (active) setLoaded({ items: [], error: explain(cause as { message?: string }) }) })
    return () => { active = false }
  }, [id, scope, enabled])
  const items = loaded?.items || []
  return {
    id, items, seen, error: loaded?.error || null, loading: !loaded,
    newCount: items.filter(item => Date.parse(item.date) > seen).length,
    markRead() { if (id) writeSeen(id); setSeen(Date.now()) }
  }
}

function Inbox({ inbox, sub }: { inbox: ReturnType<typeof useInbox>; sub: string }) {
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All')
  const ready = Boolean(inbox.id) && !inbox.loading && !inbox.error
  // Opening the inbox counts as reading it: the bell clears on the next page, and this visit keeps its New list.
  useEffect(() => { if (ready) writeSeen(inbox.id!) }, [ready, inbox.id])
  const shown = inbox.items.filter(item => filter === 'All' || item.kind === filter || filter === 'Adoption' && item.kind === 'Listing')
  const fresh = shown.filter(item => Date.parse(item.date) > inbox.seen)
  const list = (title: string, items: InboxItem[]) => items.length ? <section className="card inbox">
    <h2>{title}</h2>
    {items.map(item => <div className="queue-row" key={item.id}>
      <div className="qmain">
        <Pill>{item.kind}</Pill><time dateTime={item.date}>{fmtDate(item.date)}</time>
        <strong>{item.title}</strong>
        {item.text ? <div className="sub">{item.text}</div> : null}
      </div>
      <div className="qactions"><Link className="btn btn-sm btn-outline" to={item.to}>{item.action}</Link></div>
    </div>)}
  </section> : null
  return <>
    <div className="page-head"><h1>Inbox</h1><p className="sub">{sub}</p></div>
    {inbox.error ? <Notice kind="bad">{inbox.error}</Notice> : null}
    <div className="btn-row inbox-bar">
      {FILTERS.map(name => <button key={name} type="button" className={'btn btn-sm' + (name === filter ? '' : ' btn-outline')}
        aria-pressed={name === filter} onClick={() => setFilter(name)}>{name}</button>)}
      {inbox.newCount ? <button className="inbox-read" type="button" onClick={inbox.markRead}>Mark all as read</button> : null}
    </div>
    {inbox.loading ? <p className="sub" role="status">Loading inbox…</p> : null}
    {ready && !shown.length ? <Empty>No updates yet.</Empty> : null}
    {list(`New · ${fresh.length}`, fresh)}
    {list('Earlier', shown.filter(item => !fresh.includes(item)))}
  </>
}

export function UserInbox() {
  const inbox = useInbox('user')
  return <UserShell inboxCount={inbox.newCount}>
    <Inbox inbox={inbox} sub="Updates from CAVD about your pets, applications and account." />
  </UserShell>
}

export function OfficeInbox() {
  const inbox = useInbox('office')
  const { counts } = useCounts()
  return <OfficeShell counts={counts} inboxCount={inbox.newCount}>
    <Inbox inbox={inbox} sub="New submissions and replies that need CAVD attention, newest first." />
  </OfficeShell>
}
