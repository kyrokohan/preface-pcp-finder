import base64
import logging
import secrets
from contextlib import asynccontextmanager
from typing import Literal

import anthropic
import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, google
from .config import settings
from .enrichment import EnrichmentJobs, EnrichStatus
from .payers import PAYERS
from .store import ProfileStore

# INFO so the agent's per-call token usage (i.e. cost) shows up in the server logs.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    http = httpx.AsyncClient(timeout=20)
    claude = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    store = ProfileStore(settings.db_path)
    jobs = EnrichmentJobs(
        claude,
        store,
        concurrency=settings.enrich_concurrency,
        timeout_s=settings.enrich_timeout_s,
        max_age_s=settings.profile_ttl_days * 86400,
    )
    app.state.http = http
    app.state.jobs = jobs
    yield
    # Stop in-flight research before closing the client and store it depends on.
    await jobs.aclose()
    await http.aclose()
    await claude.close()
    store.close()


app = FastAPI(title="PCP Finder", lifespan=lifespan)


def _authorized(request: Request) -> bool:
    if not settings.basic_auth_pass:
        # A user without a password is a misconfiguration: deny rather than accept "".
        return False
    scheme, _, encoded = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        user, _, password = base64.b64decode(encoded).decode().partition(":")
    except (ValueError, UnicodeDecodeError):
        return False
    return secrets.compare_digest(
        user.encode(), settings.basic_auth_user.encode()
    ) and secrets.compare_digest(password.encode(), settings.basic_auth_pass.encode())


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    # Internal tool backed by paid APIs: protect everything (API and the React files) except
    # the platform health check.
    if settings.basic_auth_user and request.url.path != "/api/health" and not _authorized(request):
        return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="PCP Finder"'})
    return await call_next(request)


class SearchRequest(BaseModel):
    zip: str = Field(pattern=r"^\d{5}$")
    # Stays under the Places API's 50 km limit for a location bias.
    radius_mi: float = Field(default=5, gt=0, le=25)
    age_group: Literal["adult", "child"] = "adult"


class SearchResponse(BaseModel):
    providers: list[google.Provider]


@app.post("/api/search")
async def search(body: SearchRequest, request: Request) -> SearchResponse:
    http = request.app.state.http
    try:
        lat, lng = await google.geocode_zip(http, body.zip)
        providers = await google.search_providers(http, lat, lng, body.radius_mi, body.age_group)
    except google.ZipNotFound:
        raise HTTPException(404, f"ZIP {body.zip} was not found") from None
    except google.OutsideServiceArea:
        raise HTTPException(422, f"ZIP {body.zip} is outside Los Angeles County") from None
    except (google.GoogleApiError, httpx.HTTPError) as exc:
        raise HTTPException(502, str(exc)) from exc
    return SearchResponse(providers=providers)


@app.post("/api/enrich")
async def start_enrichment(body: agent.PracticeInput, request: Request) -> EnrichStatus:
    """Starts research for a practice (unless a fresh profile exists or it's already running)."""
    return request.app.state.jobs.start(body)


@app.get("/api/enrich/{place_id}")
async def enrichment_status(place_id: str, request: Request) -> EnrichStatus:
    return request.app.state.jobs.status(place_id)


@app.get("/api/payers")
async def payers() -> list[str]:
    return PAYERS


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


if settings.static_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
