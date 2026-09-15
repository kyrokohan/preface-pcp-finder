import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { enrichProvider, fetchPayers, runPool, searchProviders } from './api'
import { ProviderCard } from './components/ProviderCard'
import { type RankContext, type Ranking, rankProviders } from './rank'
import type { AgeGroup, EnrichState, Findings, Provider } from './types'

const RADII_MI = [2, 5, 10, 15]
// Payers come from the backend because the agent normalizes plan names to that exact list.
// Languages are only matched loosely here in the browser, so the list can live locally.
const LANGUAGES = [
  'Spanish',
  'Korean',
  'Mandarin',
  'Cantonese',
  'Armenian',
  'Tagalog',
  'Vietnamese',
  'Farsi',
  'Russian',
  'Japanese',
  'Arabic',
  'Hindi',
]
// Research starts for at most this many cards at once. Cards still queued never start when the
// navigator runs a new search, so abandoned results don't cost Claude calls. The backend has its
// own limit across all navigators.
const ENRICH_CONCURRENCY = 4

const EMPTY_RANKING: Ranking = { ranked: [], notPrimaryCare: [] }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export default function App() {
  const [zip, setZip] = useState('')
  const [radiusMi, setRadiusMi] = useState(5)
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('adult')
  const [plan, setPlan] = useState('')
  const [language, setLanguage] = useState('')
  const [payers, setPayers] = useState<string[]>([])

  const [providers, setProviders] = useState<Provider[]>([])
  const [searchedRadiusMi, setSearchedRadiusMi] = useState(5)
  const [enrichById, setEnrichById] = useState<Record<string, EnrichState>>({})
  const [ranking, setRanking] = useState<Ranking>(EMPTY_RANKING)
  const [rankingStale, setRankingStale] = useState(false)
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
  const findingsById = useMemo(() => {
    const result: Record<string, Findings> = {}
    for (const [id, state] of Object.entries(enrichById)) {
      if (state.status === 'done') result[id] = state.data.findings
    }
    return result
  }, [enrichById])
  const loadedCount = Object.values(enrichById).filter((s) => s.status === 'done').length

  function rerank(overrides: Partial<RankContext> = {}) {
    setRanking(rankProviders(providers, findingsById, { radiusMi: searchedRadiusMi, plan, language, ...overrides }))
    setRankingStale(false)
  }

  async function enrichOne(provider: Provider, generation: number, refresh = false) {
    const isStale = () => generation !== searchGeneration.current
    if (isStale()) return
    setEnrichById((prev) => ({ ...prev, [provider.place_id]: { status: 'running' } }))
    try {
      const data = await enrichProvider(provider, { refresh, isCancelled: isStale })
      if (!data || isStale()) return
      setEnrichById((prev) => ({ ...prev, [provider.place_id]: { status: 'done', data } }))
      // Don't reorder cards under the navigator; offer a re-rank instead.
      setRankingStale(true)
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
    setRanking(EMPTY_RANKING)
    setRankingStale(false)
    setShowNotPrimaryCare(false)

    try {
      const result = await searchProviders(zip, radiusMi, ageGroup)
      if (generation !== searchGeneration.current) return
      const initial = rankProviders(result.providers, {}, { radiusMi, plan, language })
      setProviders(result.providers)
      setSearchedRadiusMi(radiusMi)
      setRanking(initial)
      setSearching(false)

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
      <li key={id}>
        <ProviderCard
          provider={provider}
          rank={rank}
          state={enrichById[id]}
          plan={plan}
          language={language}
          onRefresh={() => enrichOne(provider, searchGeneration.current, true)}
        />
      </li>
    )
  }

  const inputClass =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600 focus:outline-none'

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <h1 className="text-xl font-semibold">PCP Finder</h1>
          <p className="text-sm text-slate-500">
            Nearby primary care providers in Los Angeles County, with insurance, availability and sources.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <form
          onSubmit={onSearch}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
        >
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
                setPlan(e.target.value)
                rerank({ plan: e.target.value })
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
          <Field label="Language">
            <select
              className={inputClass}
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value)
                rerank({ language: e.target.value })
              }}
            >
              <option value="">Any</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={searching}
              className="w-full rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {searching ? 'Searching…' : 'Find providers'}
            </button>
          </div>
        </form>

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {providers.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <span>
              {ranking.ranked.length} providers · details loaded for {loadedCount} of {providers.length}
            </span>
            {rankingStale && (
              <button
                type="button"
                onClick={() => rerank()}
                className="rounded-md bg-amber-100 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-200"
              >
                New details loaded · re-rank
              </button>
            )}
          </div>
        )}

        <ol className="mt-3 space-y-4">{ranking.ranked.map((id, i) => renderCard(id, i + 1))}</ol>

        {ranking.notPrimaryCare.length > 0 && (
          <section className="mt-8">
            <button
              type="button"
              onClick={() => setShowNotPrimaryCare((v) => !v)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
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
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
