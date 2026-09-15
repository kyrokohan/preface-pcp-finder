import type { Findings, Provider } from './types'

// Bayesian average pulls ratings with few reviews toward a prior, so 5.0★ from 3 reviews
// doesn't outrank 4.7★ from 900.
const RATING_PRIOR = 4.0
const RATING_PRIOR_WEIGHT = 20

export interface RankContext {
  radiusMi: number
  plan: string
}

export interface Ranking {
  ranked: string[]
  notPrimaryCare: string[]
}

export function bayesianRating(rating: number | null, reviewCount: number): number {
  if (rating === null || reviewCount === 0) return RATING_PRIOR
  return (reviewCount * rating + RATING_PRIOR_WEIGHT * RATING_PRIOR) / (reviewCount + RATING_PRIOR_WEIGHT)
}

export function acceptsPlan(findings: Findings, plan: string): boolean {
  const wanted = plan.toLowerCase()
  return findings.insurance_plans.some((p) => p.name.toLowerCase() === wanted)
}

/**
 * Base score is proximity + review-adjusted rating. Once research arrives, it adjusts for what
 * matters to this patient: listing their plan (+0.15) and accepting new patients (+0.1), or not
 * accepting them (-0.2, since that usually rules the practice out). Unknown facts change nothing,
 * so missing data is never treated as a "no".
 */
function scoreProvider(provider: Provider, findings: Findings | undefined, ctx: RankContext): number {
  const proximity = Math.max(0, 1 - provider.distance_mi / ctx.radiusMi)
  let score = 0.5 * proximity + 0.5 * (bayesianRating(provider.rating, provider.review_count) / 5)
  if (!findings) return score
  if (ctx.plan && acceptsPlan(findings, ctx.plan)) score += 0.15
  if (findings.accepting_new_patients.value === true) score += 0.1
  if (findings.accepting_new_patients.value === false) score -= 0.2
  return score
}

export function rankProviders(
  providers: Provider[],
  findingsById: Record<string, Findings>,
  ctx: RankContext,
): Ranking {
  const scored = providers
    .map((provider) => {
      const findings = findingsById[provider.place_id]
      return { id: provider.place_id, findings, score: scoreProvider(provider, findings, ctx) }
    })
    .sort((a, b) => b.score - a.score)
  return {
    ranked: scored.filter((s) => s.findings?.is_primary_care !== false).map((s) => s.id),
    notPrimaryCare: scored.filter((s) => s.findings?.is_primary_care === false).map((s) => s.id),
  }
}
