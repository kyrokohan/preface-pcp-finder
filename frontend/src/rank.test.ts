import { describe, expect, it } from 'vitest'
import { bayesianRating, rankProviders } from './rank'
import type { Fact, Findings, Provider } from './types'

function unknown<T>(): Fact<T> {
  return { value: null, source_url: null, quote: null }
}

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    place_id: 'id',
    name: 'Practice',
    address: '',
    lat: 0,
    lng: 0,
    distance_mi: 1,
    phone: null,
    website: null,
    rating: 4.5,
    review_count: 100,
    open_now: null,
    hours: [],
    google_maps_url: null,
    primary_type: 'doctor',
    types: [],
    ...overrides,
  }
}

function makeFindings(overrides: Partial<Findings> = {}): Findings {
  return {
    is_primary_care: true,
    practice_type: null,
    ages_served: null,
    website: unknown(),
    booking_url: unknown(),
    booking_platform: null,
    next_available: unknown(),
    same_day_or_walk_in: unknown(),
    availability_notes: unknown(),
    accepting_new_patients: unknown(),
    telehealth: unknown(),
    languages: unknown(),
    insurance_plans: [],
    insurance_notes: unknown(),
    years_in_business: { since_year: null, basis: null, source_url: null, quote: null },
    summary: null,
    ...overrides,
  }
}

const ctx = { radiusMi: 5, plan: '', language: '' }

describe('rankProviders', () => {
  it('does not let a handful of perfect reviews beat many strong ones', () => {
    expect(bayesianRating(5, 3)).toBeLessThan(bayesianRating(4.7, 900))
  })

  it('ranks nearer providers first when ratings are equal', () => {
    const near = makeProvider({ place_id: 'near', distance_mi: 0.5 })
    const far = makeProvider({ place_id: 'far', distance_mi: 4 })
    expect(rankProviders([far, near], {}, ctx).ranked).toEqual(['near', 'far'])
  })

  it("boosts providers that list the patient's plan", () => {
    const a = makeProvider({ place_id: 'a', distance_mi: 1 })
    const b = makeProvider({ place_id: 'b', distance_mi: 1.5 })
    const findings = {
      a: makeFindings(),
      b: makeFindings({ insurance_plans: [{ name: 'L.A. Care', source_url: null, quote: null }] }),
    }
    expect(rankProviders([a, b], findings, { ...ctx, plan: 'L.A. Care' }).ranked).toEqual(['b', 'a'])
  })

  it('separates practices the agent identified as not primary care', () => {
    const pcp = makeProvider({ place_id: 'pcp' })
    const urgentCare = makeProvider({ place_id: 'urgent' })
    const ranking = rankProviders([pcp, urgentCare], { urgent: makeFindings({ is_primary_care: false }) }, ctx)
    expect(ranking).toEqual({ ranked: ['pcp'], notPrimaryCare: ['urgent'] })
  })
})
