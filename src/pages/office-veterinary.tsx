import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate, petLine } from '../lib/format'
import { fetchRegistryPage, REGISTRY_PAGE_SIZE } from '../lib/pet-registry'
import { explain, supabase } from '../lib/supabase'
import type { Pet, Visit } from '../lib/types'
import { useEligibilityReport } from '../lib/use-eligibility-report'
import { visitKinds } from '../lib/visits'
import { Empty, Field, Notice, Pagination, PetCode, Photo, clearancePill, registryPill } from '../ui'
import { OfficeShell, useCounts } from './office'

type RecentVisit = Visit & { pet: Pet | null }

export function OfficeVeterinary() {
  const { counts } = useCounts()
  const eligibility = useEligibilityReport()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Pet[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentVisit[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [monthly, setMonthly] = useState<{ visits: number; vaccinations: number } | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // Registry access is independent of whether a pet has any visits.
        const result = await fetchRegistryPage({ page, search, status: 'approved' })
        if (!current) return
        if (result.error) throw result.error
        const count = result.count || 0
        const lastPage = Math.max(0, Math.ceil(count / REGISTRY_PAGE_SIZE) - 1)
        setTotal(count)
        if (page > lastPage) { setPage(lastPage); return }
        setRows((result.data || []) as Pet[])
      } catch (cause) {
        if (current) { setError(explain(cause as { message?: string })); setRows([]); setTotal(0) }
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => { current = false }
  }, [page, search])

  useEffect(() => {
    let current = true
    const monthStart = new Date().toISOString().slice(0, 8) + '01'
    const monthVisits = () => supabase.from('visits').select('id', { count: 'exact', head: true }).gte('visit_date', monthStart)
    Promise.all([
      supabase.from('visits').select('*,pet:pets(*)').eq('verification_status', 'cavd_confirmed')
        .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).limit(10),
      monthVisits(),
      monthVisits().eq('visit_type', 'vaccination')
    ]).then(([latest, visits, vaccinations]) => {
      if (!current) return
      if (latest.error) setRecentError(explain(latest.error))
      setRecent((latest.data || []) as RecentVisit[])
      if (!visits.error && !vaccinations.error) setMonthly({ visits: visits.count || 0, vaccinations: vaccinations.count || 0 })
      setRecentLoading(false)
    })
    return () => { current = false }
  }, [])

  function lookup(event: FormEvent) {
    event.preventDefault()
    setPage(0)
    setSearch(q.trim())
  }

  const awaiting = eligibility.report?.filter(row => row.latest_clearance === 'pending' || row.latest_clearance === 'hold').length

  return <OfficeShell counts={counts}>
    <div className="page-head"><h1>Veterinary</h1><p className="sub">Find a registered pet to record a visit, set its adoption clearance, or update its details.</p></div>
    <div className="dashboard">
    <dl className="dashboard-metrics" aria-label="Veterinary overview">
      <div><dt>Visits this month</dt><dd>{monthly?.visits ?? '—'}</dd></div>
      <div><dt>Pets awaiting clearance</dt><dd>{awaiting ?? '—'}</dd></div>
      <div><dt>Vaccination visits this month</dt><dd>{monthly?.vaccinations ?? '—'}</dd></div>
    </dl>
    {eligibility.error ? <Notice kind="warn">{eligibility.error}</Notice> : null}

    <section className="card" aria-labelledby="veterinary-search-title">
      <h2 id="veterinary-search-title">Find a registered pet</h2>
      <form className="filters search-form" onSubmit={lookup}>
        <Field label="Name, breed, species or PET ID"><input type="search" value={q} onChange={event => setQ(event.target.value)} placeholder="e.g. Bantay or K7N2P9QX" /></Field>
        <button className="btn" type="submit">Search</button>
        {search ? <button className="btn btn-outline" type="button" onClick={() => { setQ(''); setSearch(''); setPage(0) }}>Show all pets</button> : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
      {loading ? <p role="status">Loading registered pets…</p> : !error ? <>
        <p className="sub">{total} approved pet{total === 1 ? '' : 's'}{search ? ' matching your search' : ''}.</p>
        {!rows.length ? <Empty>{search ? 'No approved pet matches your search.' : 'No approved registrations are available yet.'}</Empty> : null}
        {rows.map(pet => <div className="queue-row" key={pet.id}>
          <div className="avatar"><Photo url={pet.photo_url} name={pet.name} /></div>
          <div className="qmain"><div className="qtitle"><span className="pet-name">{pet.name}</span> {registryPill(pet.registry_status)}</div><div className="sub">{petLine(pet)}</div><PetCode code={pet.qr_slug} compact /></div>
          <div className="qactions"><Link className="record-link" to={'/office/pets/' + pet.id}>Open pet record</Link></div>
        </div>)}
        <Pagination label="Registered pets" page={page} pageSize={REGISTRY_PAGE_SIZE} total={total} onChange={setPage} />
      </> : null}
    </section>

    <section className="card" aria-labelledby="recent-visits-title">
      <h2 id="recent-visits-title">Recent visits</h2>
      {recentError ? <Notice kind="bad">Could not load recent visits. {recentError}</Notice> : null}
      {recentLoading ? <p role="status">Loading recent visits…</p> : !recent.length ? <Empty>Visits recorded by CAVD staff will appear here.</Empty> : <div className="table-wrap"><table className="tbl">
        <caption className="sr-only">Latest veterinary visits recorded by CAVD staff</caption>
        <thead><tr><th scope="col">Pet</th><th scope="col">PET ID</th><th scope="col">Visit date</th><th scope="col">Visit type</th><th scope="col">Clearance</th><th scope="col">Record</th></tr></thead>
        <tbody>{recent.map(visit => <tr key={visit.id}>
          <td><strong>{visit.pet?.name || 'Pet'}</strong></td>
          <td>{visit.pet ? <PetCode code={visit.pet.qr_slug} compact /> : '—'}</td>
          <td><time dateTime={visit.visit_date}>{fmtDate(visit.visit_date)}</time></td>
          <td>{visitKinds[visit.visit_type] || 'Visit'}</td>
          <td>{clearancePill(visit.clearance_status)}</td>
          <td><Link className="btn btn-sm btn-outline" to={'/office/pets/' + visit.pet_id}>Pet record</Link></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    </div>
  </OfficeShell>
}
