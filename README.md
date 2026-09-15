# PCP Finder

Internal tool for patient navigators: enter a patient's Los Angeles County ZIP code and get a ranked list of nearby primary care providers with booking, availability, insurance and years in practice.

**Live demo:** https://preface-pcp-finder-97ys9.ondigitalocean.app (user `navigator`, password sent separately)

## What happens when you click "Find providers"

1. The browser sends the ZIP, radius and age group to `POST /api/search`. The patient's insurance plan never leaves the browser.
2. The backend geocodes the ZIP with Google Geocoding and rejects ZIPs outside LA County.
3. Google Places Text Search returns the nearest 20 "primary care doctor" (or "pediatrician") listings. Closed, out-of-radius and clearly non-medical listings are dropped.
4. Cards render right away with Google's data (name, address, phone, website, rating, reviews, today's hours), ranked by proximity and review-adjusted rating.
5. For each card, 4 at a time, the browser starts a research job with `POST /api/enrich` and polls `GET /api/enrich/{place_id}`.
6. A profile saved in the last 7 days is returned immediately. Otherwise a Claude agent (`claude-sonnet-5`) reads the practice's own site first, then the web, and submits typed findings: booking link, availability, new patients, insurance, years in practice, languages and whether it's primary care. A value is recorded only when a source states it, together with the source URL and quote.
7. The findings are validated (schema errors go back to the agent to fix), saved to SQLite by Google place ID, and returned on the next poll.
8. The list re-ranks itself as details arrive. Listing the patient's plan or accepting new patients moves a practice up, not accepting moves it down, and practices that aren't primary care move to a collapsed section.

## Why it's built this way

- **Google Places for discovery:** the only source of Google ratings and reviews, with phone, website and hours in the same call.
- **An agent for the rest:** Places has no booking link or primary-care category, and insurance and availability only live on practice sites and directories.
- **Null over guesses:** unknowns stay unknown, and every value is stored with its source and quote so the agent stays grounded and results can be audited.
- **Google's terms:** only place IDs and our own findings are stored; Google data is fetched live.
- **Jobs and polling:** research takes 20–50 s, too long to hold a request open through hosting proxies, and concurrent requests for a practice share one job.
- **Sonnet with the basic web tools:** measured at 2–3× cheaper per practice than Opus, and the dynamic-filtering web tools took 259 s versus 32 s on the same practice.

## Limitations

- Live appointment slots aren't extracted yet: booking widgets render them with JavaScript, which the web fetch tool doesn't run. A headless-browser tool is the next step.
- Results are the nearest 20 Google matches.
- Google can list a group practice and its doctors separately, so duplicates can appear.
- The SQLite profile store resets on every deploy.

## Run locally

Requires Python 3.12+ with [uv](https://docs.astral.sh/uv/) and Node 22+.

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY and GOOGLE_MAPS_API_KEY (Places API (New) + Geocoding API)
cd backend && uv sync && uv run uvicorn app.main:app --reload   # API on :8000
cd frontend && npm install && npm run dev                       # UI on :5173
```

Checks: `cd backend && uv run ruff check . && uv run pytest` and `cd frontend && npm run lint && npm test`.

## Deploy

The `Dockerfile` builds the UI and serves it from FastAPI on port 8080. `.do/app.yaml` defines the DigitalOcean App Platform app with a single instance, because research jobs live in memory. Fill the three secrets into a copy of the spec, run `doctl apps create --spec <copy>`, and every push to `main` redeploys.
