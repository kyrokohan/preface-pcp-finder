import type { AgeGroup, EnrichStatus, Findings, Provider, SearchResponse } from './types'

// Research typically takes 20-50 s, too long for one request through hosting proxies, so the
// backend runs it as a job and the browser polls.
const POLL_INTERVAL_MS = 3000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data) => data.detail)
      .catch(() => null)
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`)
  }
  return response.json()
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function searchProviders(zip: string, radiusMi: number, ageGroup: AgeGroup) {
  return postJson<SearchResponse>('/api/search', { zip, radius_mi: radiusMi, age_group: ageGroup })
}

/** Starts (or joins) research for a practice and polls until it finishes. Returns null if cancelled. */
export async function enrichProvider(provider: Provider, isCancelled: () => boolean): Promise<Findings | null> {
  const { place_id, name, address, phone, website, types } = provider
  let status = await postJson<EnrichStatus>('/api/enrich', { place_id, name, address, phone, website, types })
  while (status.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    if (isCancelled()) return null
    status = await request<EnrichStatus>(`/api/enrich/${encodeURIComponent(place_id)}`)
  }
  if (status.status === 'done' && status.findings) return status.findings
  throw new Error(status.error ?? 'Research was interrupted, please retry')
}

export function fetchPayers() {
  return request<string[]>('/api/payers')
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item)
    }
  })
  await Promise.all(runners)
}
