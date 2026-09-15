"""Background research jobs, one per practice.

Research typically takes 20-30 s (120 s timeout), too long to hold one HTTP request open
through hosting proxies, so the browser starts a job and polls for the result. Jobs are keyed
by place ID, so repeated or concurrent requests for the same practice share one run.
"""

import asyncio
import logging
from typing import Literal

import anthropic
from pydantic import BaseModel, ValidationError

from . import agent
from .models import Findings
from .store import ProfileStore

log = logging.getLogger(__name__)


class EnrichStatus(BaseModel):
    place_id: str
    status: Literal["running", "done", "error", "not_started"]
    findings: Findings | None = None
    as_of: float | None = None
    error: str | None = None


class EnrichmentJobs:
    def __init__(
        self,
        claude: anthropic.AsyncAnthropic,
        store: ProfileStore,
        *,
        concurrency: int,
        timeout_s: float,
        max_age_s: float,
    ):
        self._claude = claude
        self._store = store
        self._slots = asyncio.Semaphore(concurrency)
        self._timeout_s = timeout_s
        self._max_age_s = max_age_s
        self._running: dict[str, asyncio.Task[None]] = {}
        self._errors: dict[str, str] = {}

    def start(self, practice: agent.PracticeInput, refresh: bool) -> EnrichStatus:
        place_id = practice.place_id
        if place_id not in self._running:
            self._errors.pop(place_id, None)
            profile = None if refresh else self._load_profile(place_id)
            if profile is not None:
                return self._done(place_id, profile)
            self._running[place_id] = asyncio.create_task(self._run(practice))
        return EnrichStatus(place_id=place_id, status="running")

    def status(self, place_id: str) -> EnrichStatus:
        if place_id in self._running:
            return EnrichStatus(place_id=place_id, status="running")
        if place_id in self._errors:
            return EnrichStatus(place_id=place_id, status="error", error=self._errors[place_id])
        if (profile := self._load_profile(place_id)) is not None:
            return self._done(place_id, profile)
        # Nothing known, e.g. a redeploy cleared in-memory jobs mid-poll; the UI offers a retry.
        return EnrichStatus(place_id=place_id, status="not_started")

    async def aclose(self) -> None:
        """Cancels in-flight research, e.g. when the server shuts down for a redeploy."""
        tasks = list(self._running.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def _load_profile(self, place_id: str) -> tuple[Findings, float] | None:
        hit = self._store.get(place_id, self._max_age_s)
        if hit is None:
            return None
        findings, as_of = hit
        try:
            return Findings.model_validate(findings), as_of
        except ValidationError:
            # Saved under an older Findings schema: treat as missing so it's researched again.
            return None

    @staticmethod
    def _done(place_id: str, profile: tuple[Findings, float]) -> EnrichStatus:
        findings, as_of = profile
        return EnrichStatus(place_id=place_id, status="done", findings=findings, as_of=as_of)

    async def _run(self, practice: agent.PracticeInput) -> None:
        place_id = practice.place_id
        try:
            async with self._slots:
                findings = await asyncio.wait_for(
                    agent.enrich(self._claude, practice), self._timeout_s
                )
            self._store.put(place_id, findings.model_dump(mode="json"))
        except TimeoutError:
            self._errors[place_id] = "Researching this practice timed out"
        except agent.EnrichmentError as exc:
            self._errors[place_id] = str(exc)
        except anthropic.APIError as exc:
            self._errors[place_id] = f"Claude API error: {exc.message}"
        except Exception:
            # Nothing awaits this task, so record the failure for the poller instead of losing it.
            log.exception("Enrichment failed for %s", place_id)
            self._errors[place_id] = "Unexpected error while researching this practice"
        finally:
            del self._running[place_id]
