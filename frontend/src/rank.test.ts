import { describe, expect, it } from 'vitest'
import { bayesianRating, rankProviders } from './rank'
import type { Findings, Provider } from './types'

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    place_id: 'id',
    name: 'Practice',
    address: '',
    distance_mi: 1,
    phone: null,
    website: null,
    rating: 4.5,
    review_count: 100,
    open_now: null,
    hours: [],
    google_maps_url: null,
    types: [],
    ...overrides,
  }
}

function makeFindings(overrides: Partial<Findings> = {}): Findings {
  return {
    is_primary_care: true,
    practice_type: null,
    ages_served: null,
    website: { value: null },
    booking_url: { value: null },
    next_available: { value: null },
    same_day_or_walk_in: { value: null },
    availability_notes: { value: null },
    accepting_new_patients: { value: null },
    telehealth: { value: null },
    languages: { value: null },
    insurance_plans: [],
    insurance_notes: { value: null },
    years_in_business: { since_year: null, basis: null },
    summary: null,
    ...overrides,
  }
}

const ctx = { radiusMi: 5, plan: '' }

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
      b: makeFindings({ insurance_plans: [{ name: 'L.A. Care' }] }),
    }
    expect(rankProviders([a, b], findings, { ...ctx, plan: 'L.A. Care' }).ranked).toEqual(['b', 'a'])
  })

  it('penalizes "not accepting new patients" but not an unknown status', () => {
    // The unknown-status practice is slightly closer, so it only stays ahead of the practice
    // without any findings if an unknown status costs nothing.
    const unknownStatus = makeProvider({ place_id: 'unknown', distance_mi: 1 })
    const noFindings = makeProvider({ place_id: 'no-findings', distance_mi: 1.1 })
    const notAccepting = makeProvider({ place_id: 'not-accepting', distance_mi: 0.5 })
    const findings = {
      unknown: makeFindings(),
      'not-accepting': makeFindings({ accepting_new_patients: { value: false } }),
    }
    expect(rankProviders([notAccepting, noFindings, unknownStatus], findings, ctx).ranked).toEqual([
      'unknown',
      'no-findings',
      'not-accepting',
    ])
  })

  it('separates practices the agent identified as not primary care', () => {
    const pcp = makeProvider({ place_id: 'pcp' })
    const urgentCare = makeProvider({ place_id: 'urgent' })
    const ranking = rankProviders([pcp, urgentCare], { urgent: makeFindings({ is_primary_care: false }) }, ctx)
    expect(ranking).toEqual({ ranked: ['pcp'], notPrimaryCare: ['urgent'] })
  })
})
