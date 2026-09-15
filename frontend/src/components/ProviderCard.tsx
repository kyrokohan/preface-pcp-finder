import type { ReactNode } from 'react'
import { acceptsPlan, speaksLanguage } from '../rank'
import type { BookingPlatform, EnrichState, Fact, Findings, Provider, Sourced, YearsInBusiness } from '../types'

// "phone_only" and "other" have no label: they render as "Books by phone" / a plain "Book online".
const PLATFORM_LABELS: Partial<Record<BookingPlatform, string>> = {
  zocdoc: 'Zocdoc',
  mychart: 'MyChart',
  athenahealth: 'athenahealth',
  healow: 'healow',
  nexhealth: 'NexHealth',
  solv: 'Solv',
  onemedical: 'One Medical',
  kaiser: 'Kaiser Permanente',
  practice_website_form: 'practice website',
}

const YEARS_BASIS_LABELS = {
  practice_founded: 'practice founded',
  physician_experience: "lead physician's experience",
  npi_enumeration: 'NPI registry record',
}

interface Props {
  provider: Provider
  rank: number | null
  state: EnrichState | undefined
  plan: string
  language: string
  onRefresh: () => void
}

export function ProviderCard({ provider, rank, state, plan, language, onRefresh }: Props) {
  const findings = state?.status === 'done' ? state.data.findings : undefined
  const website = provider.website ?? findings?.website.value ?? null
  const practiceLine = [findings?.practice_type, findings?.ages_served].filter(Boolean).join(' · ')

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {rank !== null && <span className="text-sm font-semibold text-slate-400">#{rank}</span>}
            <h2 className="text-lg font-semibold text-slate-900">{provider.name}</h2>
            {findings?.is_primary_care === false && <Badge tone="amber">Likely not primary care</Badge>}
          </div>
          {practiceLine && <p className="text-sm text-slate-500">{practiceLine}</p>}
          <p className="mt-1 text-sm text-slate-700">{provider.address}</p>
          <p className="text-sm text-slate-500">≈ {provider.distance_mi.toFixed(1)} mi from ZIP center</p>
        </div>
        <div className="text-right">
          {provider.rating !== null ? (
            <p className="text-lg font-semibold text-slate-900">★ {provider.rating.toFixed(1)}</p>
          ) : (
            <p className="text-sm text-slate-500">No rating</p>
          )}
          <p className="text-sm text-slate-500">{provider.review_count} Google reviews</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
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
          <OfficeHours provider={provider} />
          {findings ? <AvailabilityDetails findings={findings} /> : <Pending state={state} />}
        </Panel>
        <Panel title="Insurance">
          {findings ? <InsuranceDetails findings={findings} plan={plan} /> : <Pending state={state} />}
        </Panel>
        <Panel title="Practice">
          {findings ? <PracticeDetails findings={findings} language={language} /> : <Pending state={state} />}
        </Panel>
      </div>

      <Footer state={state} onRefresh={onRefresh} />
    </article>
  )
}

function OfficeHours({ provider }: { provider: Provider }) {
  return (
    <div className="mb-2 text-sm">
      {provider.open_now !== null && (
        <Badge tone={provider.open_now ? 'green' : 'slate'}>{provider.open_now ? 'Open now' : 'Closed now'}</Badge>
      )}
      {provider.hours.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-slate-600">Office hours</summary>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {provider.hours.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-1 text-slate-500">Hours not listed on Google</p>
      )}
    </div>
  )
}

function AvailabilityDetails({ findings }: { findings: Findings }) {
  const { booking_url, booking_platform, next_available, same_day_or_walk_in, telehealth, availability_notes } =
    findings
  const platform = booking_platform ? PLATFORM_LABELS[booking_platform] : undefined
  return (
    <div className="space-y-1.5 text-sm">
      {booking_url.value ? (
        <a
          href={booking_url.value}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800"
        >
          Book online{platform ? ` · ${platform}` : ''}
        </a>
      ) : (
        <p className="text-slate-700">
          {booking_platform === 'phone_only' ? 'Books by phone' : 'No online booking found · call to book'}
        </p>
      )}
      {next_available.value && (
        <p>
          <span className="text-slate-500">Next available:</span> {next_available.value}
        </p>
      )}
      <YesNo
        fact={findings.accepting_new_patients}
        yes="Accepting new patients"
        no="Not accepting new patients"
        unknown="New patients: unknown"
      />
      {same_day_or_walk_in.value === true && <p>Same-day or walk-in visits</p>}
      {telehealth.value === true && <p>Telehealth available</p>}
      {availability_notes.value && <p className="text-slate-600">{availability_notes.value}</p>}
    </div>
  )
}

function InsuranceDetails({ findings, plan }: { findings: Findings; plan: string }) {
  const plans = findings.insurance_plans
  return (
    <div className="space-y-2 text-sm">
      {plan &&
        (acceptsPlan(findings, plan) ? (
          <Badge tone="green">Accepts {plan}</Badge>
        ) : (
          <Badge tone="amber">{plan} not listed · call to verify</Badge>
        ))}
      {plans.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {plans.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <Badge tone="slate">{p.name}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-500">Not listed online · call to verify</p>
      )}
      {findings.insurance_notes.value && <p className="text-slate-600">{findings.insurance_notes.value}</p>}
    </div>
  )
}

function PracticeDetails({ findings, language }: { findings: Findings; language: string }) {
  const languages = findings.languages.value ?? []
  return (
    <div className="space-y-1.5 text-sm">
      <YearsInBusinessLine years={findings.years_in_business} />
      {languages.length > 0 ? (
        <p>
          <span className="text-slate-500">Languages:</span> {languages.join(', ')}
        </p>
      ) : (
        <p className="text-slate-500">Languages: not listed</p>
      )}
      {language &&
        (speaksLanguage(findings, language) ? (
          <Badge tone="green">Speaks {language}</Badge>
        ) : (
          <Badge tone="amber">{language} not listed</Badge>
        ))}
      {findings.summary && <p className="text-slate-600">{findings.summary}</p>}
    </div>
  )
}

function YearsInBusinessLine({ years }: { years: YearsInBusiness }) {
  if (!years.since_year) return <p className="text-slate-500">Years in business: unknown</p>
  const count = Math.max(0, new Date().getFullYear() - years.since_year)
  // NPIs were first issued in 2005, so an enumeration date is a lower bound on years in practice.
  const atLeast = years.basis === 'npi_enumeration' ? '≥ ' : ''
  return (
    <p>
      <span className="font-medium">
        {atLeast}
        {count} years
      </span>{' '}
      <span className="text-slate-500">
        (since {years.since_year}
        {years.basis ? ` · ${YEARS_BASIS_LABELS[years.basis]}` : ''})
      </span>
    </p>
  )
}

function Footer({ state, onRefresh }: { state: EnrichState | undefined; onRefresh: () => void }) {
  const attribution = 'Address, phone, rating, reviews and hours from Google.'
  if (state?.status === 'error') {
    return (
      <p className="mt-3 text-sm text-red-700">
        Couldn't research details: {state.message}{' '}
        <button type="button" onClick={onRefresh} className="ml-1 underline">
          Retry
        </button>
      </p>
    )
  }
  if (state?.status !== 'done') {
    return (
      <p className="mt-3 text-xs text-slate-500">
        {state ? 'Researching the practice website and web sources…' : 'Queued for research…'} {attribution}
      </p>
    )
  }
  return (
    <>
      <Sources findings={state.data.findings} />
      <p className="mt-2 text-xs text-slate-400">
        Details checked {new Date(state.data.as_of * 1000).toLocaleString()} · confirm by phone before booking ·{' '}
        <button type="button" onClick={onRefresh} className="underline">
          Refresh
        </button>{' '}
        · {attribution}
      </p>
    </>
  )
}

function Sources({ findings }: { findings: Findings }) {
  const facts: [string, Sourced][] = [
    ['Website', findings.website],
    ['Booking', findings.booking_url],
    ['Next available', findings.next_available],
    ['Same-day / walk-in', findings.same_day_or_walk_in],
    ['Availability', findings.availability_notes],
    ['New patients', findings.accepting_new_patients],
    ['Telehealth', findings.telehealth],
    ['Languages', findings.languages],
    ...findings.insurance_plans.map((p): [string, Sourced] => [`Insurance: ${p.name}`, p]),
    ['Insurance notes', findings.insurance_notes],
    ['Years in business', findings.years_in_business],
  ]
  const sourced = facts.filter(([, fact]) => fact.source_url)
  if (sourced.length === 0) return null
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-slate-600">Sources ({sourced.length})</summary>
      <ul className="mt-2 space-y-2">
        {sourced.map(([label, fact], i) => (
          <li key={i} className="border-l-2 border-slate-200 pl-3">
            <p className="font-medium text-slate-700">{label}</p>
            {fact.quote && <p className="text-slate-600 italic">“{fact.quote}”</p>}
            <a
              href={fact.source_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="break-all text-teal-700 hover:underline"
            >
              {fact.source_url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

function YesNo({ fact, yes, no, unknown }: { fact: Fact<boolean>; yes: string; no: string; unknown: string }) {
  if (fact.value === true) return <p className="text-green-700">{yes}</p>
  if (fact.value === false) return <p className="text-red-700">{no}</p>
  return <p className="text-slate-500">{unknown}</p>
}

function Pending({ state }: { state: EnrichState | undefined }) {
  if (state?.status === 'error') return <p className="text-sm text-slate-500">Unavailable</p>
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-slate-50 p-3">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

const BADGE_TONES = {
  green: 'bg-green-50 text-green-800 ring-green-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  slate: 'bg-white text-slate-700 ring-slate-200',
}

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

function LinkButton({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
    >
      {children}
    </a>
  )
}
