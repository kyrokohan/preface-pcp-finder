// Mirrors the backend response models: google.py (Provider), models.py (Findings),
// main.py (SearchResponse) and enrichment.py (EnrichStatus).

export type AgeGroup = 'adult' | 'child'

export interface Provider {
  place_id: string
  name: string
  address: string
  distance_mi: number
  phone: string | null
  website: string | null
  rating: number | null
  review_count: number
  open_now: boolean | null
  hours: string[]
  google_maps_url: string | null
  types: string[]
}

export interface Sourced {
  source_url: string | null
  quote: string | null
}

export interface Fact<T> extends Sourced {
  value: T | null
}

export type BookingPlatform =
  | 'zocdoc'
  | 'mychart'
  | 'athenahealth'
  | 'healow'
  | 'nexhealth'
  | 'solv'
  | 'onemedical'
  | 'kaiser'
  | 'practice_website_form'
  | 'phone_only'
  | 'other'

export interface InsurancePlan extends Sourced {
  name: string
}

export interface YearsInBusiness extends Sourced {
  since_year: number | null
  basis: 'practice_founded' | 'physician_experience' | 'npi_enumeration' | null
}

export interface Findings {
  is_primary_care: boolean | null
  practice_type: string | null
  ages_served: string | null
  website: Fact<string>
  booking_url: Fact<string>
  booking_platform: BookingPlatform | null
  next_available: Fact<string>
  same_day_or_walk_in: Fact<boolean>
  availability_notes: Fact<string>
  accepting_new_patients: Fact<boolean>
  telehealth: Fact<boolean>
  languages: Fact<string[]>
  insurance_plans: InsurancePlan[]
  insurance_notes: Fact<string>
  years_in_business: YearsInBusiness
  summary: string | null
}

export interface SearchResponse {
  providers: Provider[]
}

export interface EnrichStatus {
  place_id: string
  status: 'running' | 'done' | 'error' | 'not_started'
  findings: Findings | null
  as_of: number | null
  error: string | null
}

export interface EnrichResult {
  findings: Findings
  as_of: number
}

export type EnrichState =
  | { status: 'running' }
  | { status: 'done'; data: EnrichResult }
  | { status: 'error'; message: string }
