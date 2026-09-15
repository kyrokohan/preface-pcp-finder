// The parts of the backend response models the UI uses: google.py (Provider), models.py
// (Findings), main.py (SearchResponse) and enrichment.py (EnrichStatus). The backend also stores
// a source URL and quote for each fact, which the UI doesn't show.

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

export interface Fact<T> {
  value: T | null
}

export interface InsurancePlan {
  name: string
}

export interface YearsInBusiness {
  since_year: number | null
  basis: 'practice_founded' | 'physician_experience' | 'npi_enumeration' | null
}

export interface Findings {
  is_primary_care: boolean | null
  practice_type: string | null
  ages_served: string | null
  website: Fact<string>
  booking_url: Fact<string>
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
  error: string | null
}

export type EnrichState =
  | { status: 'running' }
  | { status: 'done'; findings: Findings }
  | { status: 'error'; message: string }
