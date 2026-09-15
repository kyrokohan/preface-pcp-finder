import asyncio

from app import agent
from app.enrichment import EnrichmentJobs
from app.models import Findings
from app.store import ProfileStore

PRACTICE = agent.PracticeInput(place_id="place-1", name="Clinic", address="1 Main St")


def make_jobs(store: ProfileStore) -> EnrichmentJobs:
    return EnrichmentJobs(None, store, concurrency=2, timeout_s=5, max_age_s=3600)


async def finish_running(jobs: EnrichmentJobs) -> None:
    await asyncio.gather(*jobs._running.values())


def test_repeated_requests_share_one_research_run(tmp_path, monkeypatch):
    calls = 0

    async def fake_enrich(client, practice):
        nonlocal calls
        calls += 1
        return Findings(is_primary_care=True)

    monkeypatch.setattr(agent, "enrich", fake_enrich)

    async def scenario():
        jobs = make_jobs(ProfileStore(tmp_path / "profiles.db"))
        assert jobs.start(PRACTICE, refresh=False).status == "running"
        assert jobs.start(PRACTICE, refresh=False).status == "running"
        await finish_running(jobs)
        # Once saved, the profile is served without starting new research.
        return jobs.status(PRACTICE.place_id), jobs.start(PRACTICE, refresh=False)

    after_run, later_request = asyncio.run(scenario())
    assert calls == 1
    assert after_run.status == "done" and after_run.findings.is_primary_care is True
    assert later_request.status == "done"


def test_failures_are_reported_and_retry_starts_a_new_run(tmp_path, monkeypatch):
    async def failing_enrich(client, practice):
        raise agent.EnrichmentError("The agent finished without submitting findings")

    async def working_enrich(client, practice):
        return Findings(practice_type="Family medicine practice")

    async def scenario():
        jobs = make_jobs(ProfileStore(tmp_path / "profiles.db"))
        monkeypatch.setattr(agent, "enrich", failing_enrich)
        jobs.start(PRACTICE, refresh=False)
        await finish_running(jobs)
        failed = jobs.status(PRACTICE.place_id)

        monkeypatch.setattr(agent, "enrich", working_enrich)
        jobs.start(PRACTICE, refresh=True)
        await finish_running(jobs)
        return failed, jobs.status(PRACTICE.place_id)

    failed, retried = asyncio.run(scenario())
    assert failed.status == "error"
    assert failed.error == "The agent finished without submitting findings"
    assert retried.status == "done"
    assert retried.findings.practice_type == "Family medicine practice"


def test_profile_saved_under_an_older_schema_is_researched_again(tmp_path, monkeypatch):
    async def working_enrich(client, practice):
        return Findings(practice_type="Family medicine practice")

    monkeypatch.setattr(agent, "enrich", working_enrich)

    async def scenario():
        store = ProfileStore(tmp_path / "profiles.db")
        store.put(PRACTICE.place_id, {"retired_field": "no longer in Findings"})
        jobs = make_jobs(store)
        first = jobs.start(PRACTICE, refresh=False)
        await finish_running(jobs)
        return first, jobs.status(PRACTICE.place_id)

    first, after = asyncio.run(scenario())
    assert first.status == "running"
    assert after.status == "done"
    assert after.findings.practice_type == "Family medicine practice"
