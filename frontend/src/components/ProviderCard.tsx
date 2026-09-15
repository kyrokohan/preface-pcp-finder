import type { ReactNode } from 'react'
import { acceptsPlan } from '../rank'
import type { EnrichState, Findings, Provider, YearsInBusiness } from '../types'

interface Props {
  provider: Provider
  rank: number | null
  state: EnrichState | undefined
  plan: string
  onRetry: () => void
}

export function ProviderCard({ provider, rank, state, plan, onRetry }: Props) {
  const findings = state?.status === 'done' ? state.findings : undefined
  const website = provider.website ?? findings?.website.value ?? null
  const bookingUrl = findings?.booking_url.value ?? null
  const practiceLine = [findings?.practice_type, findings?.ages_served].filter(Boolean).join(' · ')

  return (
    <article className="rounded-xl border border-navy/10 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">
            {rank !== null && <span className="mr-2 text-navy/70">{rank}</span>}
            {provider.name}
          </h3>
          {practiceLine && <p className="text-sm text-navy/70">{practiceLine}</p>}
          <p className="mt-1 text-sm">{provider.address}</p>
        </div>
        <div className="text-right">
          {provider.rating !== null ? (
            <p className="text-lg font-semibold">★ {provider.rating.toFixed(1)}</p>
          ) : (
            <p className="text-sm text-navy/70">No rating</p>
          )}
          <p className="text-sm text-navy/70">{provider.review_count} reviews</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {bookingUrl && (
          <a
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-coral px-3 py-1.5 text-sm font-semibold text-navy hover:bg-coral/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
          >
            Book online
          </a>
        )}
        {provider.phone && <LinkButton href={`tel:${provider.phone}`}>Call {provider.phone}</LinkButton>}
        {website && (
          <LinkButton href={website} external>
            Website
          </LinkButton>
        )}
        {provider.google_maps_url && (
          <LinkButton href={provider.google_maps_url} external>
            Google Maps
          </LinkButton>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Panel title="Availability">
          <OpenToday provider={provider} />
          {findings ? <AvailabilityDetails findings={findings} /> : <Pending state={state} />}
        </Panel>
        <Panel title="Insurance">
          {findings ? <InsuranceDetails findings={findings} plan={plan} /> : <Pending state={state} />}
        </Panel>
        <Panel title="About">{findings ? <AboutDetails findings={findings} /> : <Pending state={state} />}</Panel>
      </div>

      {state?.status === 'error' && (
        <p className="mt-3 border-l-4 border-coral pl-3 text-sm">
          Couldn't load details: {state.message}{' '}
          <button type="button" onClick={onRetry} className="font-medium underline">
            Retry
          </button>
        </p>
      )}
    </article>
  )
}

function OpenToday({ provider }: { provider: Provider }) {
  // Google gives one line per weekday ("Monday: 9:00 AM – 5:00 PM"); pick today's by name.
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const today = provider.hours.find((line) => line.startsWith(`${weekday}: `))?.slice(weekday.length + 2)
  if (provider.open_now === null && !today) return null
  return (
    <p className="mb-1 text-sm">
      {provider.open_now !== null && (
        <span className={provider.open_now ? 'font-medium' : 'text-navy/70'}>
          {provider.open_now ? 'Open now' : 'Closed now'}
        </span>
      )}
      {provider.open_now !== null && today && ' · '}
      {today && <span className="text-navy/70">Today: {today}</span>}
    </p>
  )
}

function AvailabilityDetails({ findings }: { findings: Findings }) {
  const { booking_url, accepting_new_patients, next_available, same_day_or_walk_in, telehealth } = findings
  return (
    <div className="space-y-1 text-sm">
      {!booking_url.value && <p>Call to book</p>}
      {accepting_new_patients.value === true && <p>Accepting new patients</p>}
      {accepting_new_patients.value === false && <p className="text-navy/70">Not accepting new patients</p>}
      {next_available.value && <p>Next available: {next_available.value}</p>}
      {same_day_or_walk_in.value === true && <p>Same-day or walk-in visits</p>}
      {telehealth.value === true && <p>Telehealth available</p>}
      {findings.availability_notes.value && <p className="text-navy/70">{findings.availability_notes.value}</p>}
    </div>
  )
}

function InsuranceDetails({ findings, plan }: { findings: Findings; plan: string }) {
  const plans = findings.insurance_plans
  return (
    <div className="space-y-2 text-sm">
      {plan &&
        (acceptsPlan(findings, plan) ? (
          <p>
            <span className="rounded-full bg-navy px-2 py-0.5 text-xs font-semibold text-white">✓ Accepts {plan}</span>
          </p>
        ) : (
          <p className="text-navy/70">{plan} not listed · call to verify</p>
        ))}
      {plans.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {plans.map((p, i) => (
            <li
              key={`${p.name}-${i}`}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-medium ring-1 ring-navy/15 ring-inset"
            >
              {p.name}
            </li>
          ))}
        </ul>
      ) : (
        !plan && <p className="text-navy/70">Not listed online · call to verify</p>
      )}
      {findings.insurance_notes.value && <p className="text-navy/70">{findings.insurance_notes.value}</p>}
    </div>
  )
}

function AboutDetails({ findings }: { findings: Findings }) {
  const languages = findings.languages.value ?? []
  return (
    <div className="space-y-1 text-sm">
      <YearsInPractice years={findings.years_in_business} />
      {languages.length > 0 && <p>Speaks {languages.join(', ')}</p>}
      {findings.summary && <p className="text-navy/70">{findings.summary}</p>}
    </div>
  )
}

function YearsInPractice({ years }: { years: YearsInBusiness }) {
  if (!years.since_year) return <p className="text-navy/70">Years in practice unknown</p>
  const count = Math.max(0, new Date().getFullYear() - years.since_year)
  // NPIs were first issued in 2005, so an NPI-based year is only a lower bound.
  const atLeast = years.basis === 'npi_enumeration' ? 'At least ' : ''
  return (
    <p>
      {atLeast}
      {count} years in practice <span className="text-navy/70">(since {years.since_year})</span>
    </p>
  )
}

function Pending({ state }: { state: EnrichState | undefined }) {
  if (state?.status === 'error') return <p className="text-sm text-navy/70">Unavailable</p>
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-3 w-3/4 animate-pulse rounded bg-navy/10" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-navy/10" />
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-sky p-3">
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-navy/70 uppercase">{title}</h4>
      {children}
    </section>
  )
}

function LinkButton({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-medium text-navy hover:bg-sky focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
    >
      {children}
    </a>
  )
}
