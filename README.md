# PCP Finder: patient navigator tool

A navigator enters a patient's **Los Angeles County ZIP code** and gets a **ranked list of nearby primary care providers**. Each provider shows:
- name, address, distance, phone, website
- Google rating and review count
- years in business
- insurance
- availability
- details a navigator needs: accepting new patients, languages, telehealth, ages served, and a source for every fact

This is the **MVP**: the thinnest slice that works end to end. See [Roadmap](#roadmap) for what comes next.

## How it works

```
React ──POST /api/search {zip, radius, adult|child}──► FastAPI
  │         ├─ Google Geocoding: ZIP → lat/lng (rejects ZIPs outside LA County)
  │         ├─ Google Places Text Search "primary care doctor" | "pediatrician" (nearest 20)
  │         └─ drop closed / out-of-radius / clearly non-medical listings, add distance
  │   rank.ts: proximity + review-adjusted rating (+ plan / new-patient / language bonuses)
  │
  └─ per card, 4 at a time ──POST /api/enrich (start) · GET /api/enrich/{place_id} (poll)──► FastAPI
            ├─ saved profile for this place (< 7 days)? done immediately
            └─ background job, one per place (concurrent requests share it):
                 Claude agent (claude-sonnet-5) with Anthropic's web_fetch + web_search tools
                 → reads the practice site / directories → submit_findings (typed schema)
                 → saved to the profile store → the next poll returns it
```

### Where each field comes from

| Field | Source |
|---|---|
| Name, address, phone, website, rating, review count, office hours, open now | Google Places, fetched live on every search |
| Distance | Haversine from the ZIP's center |
| Booking link and platform, next available, same-day or walk-in, accepting new patients, telehealth | Claude agent: practice website, then web search and directories |
| Insurance plans (normalized to a standard LA plan list) and caveats | Claude agent |
| Years in business | Claude agent, trying in order: when the practice was founded, the lead physician's years in practice, then the NPI registration date (shown as a minimum) |
| Primary care or not, practice type, ages served, languages | Claude agent |

Every agent fact carries a **source URL and a verbatim quote**, shown under "Sources" on each card.

## Key decisions

- **Google Places for discovery.** It's the only source of Google rating and review count, and it returns phone, website, hours and location in one call.
- **An agent for everything else.** Places has **no booking-link field** (appointment links are only exposed to the business owner) and **no primary-care category**, and insurance and availability aren't in any structured public API. The agent follows what a person would do: read the practice website, follow the appointment, insurance and about pages, then search the web when the site is missing or thin. Using Anthropic's server-side web tools means there's no crawler to maintain in the MVP.
- **Structured output via a tool.** The agent ends by calling `submit_findings`, whose schema is the Pydantic `Findings` model. Output is validated, and a schema error goes back to the agent so it can fix and resubmit.
- **Trust signals over false confidence.** Healthcare directory data is often wrong ("ghost networks").
  - Unknown values are `null` and displayed as "unknown / call to verify", never guessed.
  - Every fact has its source and quote.
  - Each card shows when its details were checked.
- **Centralized provider profile.** Google fields (live) and agent findings (stored, keyed by Google place ID) are combined into one card. The profile store is where future sources plug in: NPI registry, live slots, navigator call notes.
- **Google's terms.** Only the place ID and our own findings are stored. Google content is re-fetched on each search and labelled as coming from Google.
- **Ranking lives in the browser (`frontend/src/rank.ts`).** It depends on the navigator's inputs (patient's plan, language) and on details that arrive over time.
  - A Bayesian rating keeps 5.0★ from 3 reviews from beating 4.7★ from 900.
  - Unknowns add nothing, so missing data is never treated as a "no".
  - Cards don't reshuffle while the navigator reads; a "re-rank" button appears when new details load.
- **No PHI.** Only ZIP, plan, language and age group leave the navigator's screen.
- **Progressive loading with research jobs.** The list renders immediately, then each card starts a research job and polls for it.
  - Research can take up to a minute, longer than hosting proxies reliably hold a request open.
  - Jobs are keyed by place ID, so repeat or concurrent requests for the same practice share one run.
  - Job state is in memory, so the MVP runs as **one instance**. Scaling out means a queue and a shared store.

## Measured performance and cost

Live runs against real LA practices:
- **Per search:** Google Geocoding + Places, about $0.04, in about 1–2 s.
- **Enrichment (`claude-sonnet-5`, effort `medium`):** 21–27 s and about $0.08–0.16 per practice in live runs (tokens plus 1–2 web searches at $10/1K). A cold 20-provider search is about $2–3.
- **Why Sonnet rather than Opus:** Opus 5 cost about 2–3× as much per practice (~$0.25) for somewhat longer insurance lists. The model is one env var (`CLAUDE_MODEL`).
- **Why the basic web tools** (measured on Opus 5): Anthropic's newer web tools can "dynamically filter" by having Claude write and run code between fetches. On the same practice that took **259 s** versus **32 s** with the basic tools. It found more insurance plans (16 vs 8), but a navigator can't wait four minutes.
- **Repeat searches:** saved profiles load instantly and cost about $0.
- **Cost levers:** profile TTL, tool `max_uses`, enriching only the top N, `CLAUDE_MODEL`.

## Known limitations (MVP)

- **Live appointment slots aren't extracted yet.** Booking widgets (Epic MyChart, athena, healow…) only render slots with JavaScript, and `web_fetch` doesn't execute JS. The MVP shows office hours, the booking link and platform, and any published availability.
- **Results are the nearest 20 Google matches** for the query (no pagination).
- **Distance is measured from the ZIP center**, not the patient's address.
- **Google often lists a group practice and its individual doctors separately,** so duplicates can appear.
- **Quotes aren't machine-verified** against the page yet.
- **SQLite on App Platform is ephemeral,** which is fine for a cache but not for durable navigator data.

## Roadmap

1. **Live slots:** a headless-browser (Playwright) tool so the agent can read public no-login booking pages (Epic Open Scheduling, athena, healow, NexHealth, Phreesia, Solv). Zocdoc and Healthgrades stay link-only because Zocdoc's terms forbid collecting availability.
2. **NPI Registry match:** deterministic primary-care verification, clinicians at the location, and enumeration date.
3. **Quote checks and cost:** automatic check that each quote appears on the fetched page; URL fingerprinting of booking platforms to cut agent cost.
4. **Authoritative insurance signals:** CMS Medicare assignment, the Medi-Cal managed-care provider listing, and payer FHIR provider directories (L.A. Care, UHC, Cigna, Humana).
5. **Navigator workflow:** call-outcome notes saved to the profile, a "copy summary for patient" button, more results, and a nightly batch refresh of all LA primary care providers.

## Running locally

Requirements: Python 3.12+ with [uv](https://docs.astral.sh/uv/), and Node 22+.

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY and GOOGLE_MAPS_API_KEY (Places API (New) + Geocoding API)

# backend (http://localhost:8000)
cd backend && uv sync && uv run uvicorn app.main:app --reload

# frontend (http://localhost:5173, proxies /api to the backend)
cd frontend && npm install && npm run dev
```

Tests: `cd backend && uv run pytest` · `cd frontend && npm test`

## Deploying (DigitalOcean App Platform)

The root `Dockerfile` builds the React app and serves it from FastAPI on `$PORT` (8080).

1. Push the repo to GitHub.
2. In App Platform, create an app from the repo; it detects the Dockerfile. Set the HTTP port to 8080 and the health check to `/api/health`.
3. Add environment variables (encrypted): `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`.

Basic auth protects everything except `/api/health` when `BASIC_AUTH_USER` is set.
