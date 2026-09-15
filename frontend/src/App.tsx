import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { enrichProvider, fetchPayers, runPool, searchProviders } from './api'
import { ProviderCard } from './components/ProviderCard'
import { rankProviders } from './rank'
import type { AgeGroup, EnrichState, Findings, Provider } from './types'

const RADII_MI = [2, 5, 10, 15]
// Research starts for at most this many cards at once. Cards still queued never start when the
// navigator runs a new search, so abandoned results don't cost Claude calls. The backend has its
// own limit across all navigators.
const ENRICH_CONCURRENCY = 4

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

/**
 * Applies a state update that may reorder the list inside a view transition, so cards glide to
 * their new rank instead of jumping. Browsers without the API just apply the update.
 */
function animateReorder(update: () => void) {
  if (!('startViewTransition' in document)) {
    update()
    return
  }
  document.startViewTransition(() => flushSync(update))
}

export default function App() {
  const [zip, setZip] = useState('')
  const [radiusMi, setRadiusMi] = useState(5)
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('adult')
  const [plan, setPlan] = useState('')
  const [payers, setPayers] = useState<string[]>([])

  const [providers, setProviders] = useState<Provider[]>([])
  const [searchedZip, setSearchedZip] = useState('')
  const [searchedRadiusMi, setSearchedRadiusMi] = useState(5)
  const [enrichById, setEnrichById] = useState<Record<string, EnrichState>>({})
  const [showNotPrimaryCare, setShowNotPrimaryCare] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Incremented per search so late responses from a previous search are ignored.
  const searchGeneration = useRef(0)

  useEffect(() => {
    // The plan filter is optional: if payers fail to load, the dropdown only offers "Any".
    fetchPayers().then(setPayers, () => {})
  }, [])

  const providerById = useMemo(() => new Map(providers.map((p) => [p.place_id, p])), [providers])
  // Derived rather than stored, so the list re-ranks by itself as details arrive or the plan changes.
  const ranking = useMemo(() => {
    const findingsById: Record<string, Findings> = {}
    for (const [id, state] of Object.entries(enrichById)) {
      if (state.status === 'done') findingsById[id] = state.findings
    }
    return rankProviders(providers, findingsById, { radiusMi: searchedRadiusMi, plan })
  }, [providers, enrichById, searchedRadiusMi, plan])

  async function enrichOne(provider: Provider, generation: number) {
    const isStale = () => generation !== searchGeneration.current
    if (isStale()) return
    setEnrichById((prev) => ({ ...prev, [provider.place_id]: { status: 'running' } }))
    try {
      const findings = await enrichProvider(provider, isStale)
      if (!findings || isStale()) return
      animateReorder(() =>
        setEnrichById((prev) => ({ ...prev, [provider.place_id]: { status: 'done', findings } })),
      )
    } catch (err) {
      if (isStale()) return
      setEnrichById((prev) => ({ ...prev, [provider.place_id]: { status: 'error', message: errorMessage(err) } }))
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault()
    const generation = ++searchGeneration.current
    setSearching(true)
    setError(null)
    setProviders([])
    setEnrichById({})
    setShowNotPrimaryCare(false)

    try {
      const result = await searchProviders(zip, radiusMi, ageGroup)
      if (generation !== searchGeneration.current) return
      setProviders(result.providers)
      setSearchedZip(zip)
      setSearchedRadiusMi(radiusMi)
      setSearching(false)

      // Research in the initial rank order, so the likeliest picks fill in first.
      const initial = rankProviders(result.providers, {}, { radiusMi, plan })
      const byId = new Map(result.providers.map((p) => [p.place_id, p]))
      const inRankOrder = initial.ranked.map((id) => byId.get(id)!)
      await runPool(inRankOrder, ENRICH_CONCURRENCY, (p) => enrichOne(p, generation))
    } catch (err) {
      if (generation !== searchGeneration.current) return
      setError(errorMessage(err))
      setSearching(false)
    }
  }

  function renderCard(id: string, rank: number | null) {
    const provider = providerById.get(id)
    if (!provider) return null
    return (
      <li key={id} style={{ viewTransitionName: `card-${id}` }}>
        <ProviderCard
          provider={provider}
          rank={rank}
          state={enrichById[id]}
          plan={plan}
          onRetry={() => enrichOne(provider, searchGeneration.current)}
        />
      </li>
    )
  }

  const inputClass =
    'w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-navy focus:border-coral focus:ring-2 focus:ring-coral/40 focus:outline-none'

  return (
    <div className="min-h-screen bg-white text-navy">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-5xl px-4 py-5">
          <h1 className="text-xl font-semibold">PCP Finder</h1>
          <p className="text-sm text-white/70">Nearby primary care providers in Los Angeles County</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <form onSubmit={onSearch} className="grid gap-3 rounded-xl bg-sky p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Patient ZIP">
            <input
              className={inputClass}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              pattern="\d{5}"
              placeholder="90012"
              required
            />
          </Field>
          <Field label="Radius">
            <select className={inputClass} value={radiusMi} onChange={(e) => setRadiusMi(Number(e.target.value))}>
              {RADII_MI.map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
            </select>
          </Field>
          <Field label="Patient">
            <select className={inputClass} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value as AgeGroup)}>
              <option value="adult">Adult</option>
              <option value="child">Child</option>
            </select>
          </Field>
          <Field label="Insurance">
            <select
              className={inputClass}
              value={plan}
              onChange={(e) => {
                const value = e.target.value
                animateReorder(() => setPlan(value))
              }}
            >
              <option value="">Any</option>
              {payers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={searching}
              className="w-full rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-60"
            >
              {searching ? 'Searching…' : 'Find providers'}
            </button>
          </div>
        </form>

        {error && <p className="mt-4 rounded-md border-l-4 border-coral bg-sky p-3 text-sm">{error}</p>}

        {providers.length > 0 && (
          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              {ranking.ranked.length} providers near {searchedZip}
            </h2>
            <p className="text-xs text-navy/70">Business info and ratings from Google Maps</p>
          </div>
        )}

        <ol className="mt-3 space-y-4">{ranking.ranked.map((id, i) => renderCard(id, i + 1))}</ol>

        {ranking.notPrimaryCare.length > 0 && (
          <section className="mt-8">
            <button
              type="button"
              onClick={() => setShowNotPrimaryCare((v) => !v)}
              className="text-sm font-medium text-navy/70 hover:text-navy"
            >
              {showNotPrimaryCare ? '▾' : '▸'} Likely not primary care ({ranking.notPrimaryCare.length})
            </button>
            {showNotPrimaryCare && (
              <ol className="mt-3 space-y-4">{ranking.notPrimaryCare.map((id) => renderCard(id, null))}</ol>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-navy/70">{label}</span>
      {children}
    </label>
  )
}
