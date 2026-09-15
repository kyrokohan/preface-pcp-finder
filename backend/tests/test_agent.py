"""The agent loop against a scripted fake Claude client (no network)."""

import asyncio
from types import SimpleNamespace

import pytest

from app import agent

PRACTICE = agent.PracticeInput(place_id="place-1", name="Clinic", address="1 Main St")
USAGE = SimpleNamespace(
    input_tokens=1,
    cache_read_input_tokens=0,
    cache_creation_input_tokens=0,
    output_tokens=1,
    server_tool_use=None,
)


def response(stop_reason: str, *blocks: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(stop_reason=stop_reason, content=list(blocks), usage=USAGE)


def submission(findings: dict, block_id: str = "toolu_1") -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", name="submit_findings", id=block_id, input=findings)


class FakeClaude:
    """Returns scripted responses in order and records the messages sent on each call."""

    def __init__(self, *responses: SimpleNamespace):
        self._responses = list(responses)
        self.sent: list[list[dict]] = []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.sent.append(list(kwargs["messages"]))
        return self._responses.pop(0)


def run(client: FakeClaude):
    return asyncio.run(agent.enrich(client, PRACTICE))


def test_invalid_submission_is_sent_back_and_the_resubmission_is_used():
    client = FakeClaude(
        response("tool_use", submission({"findings": {"is_primary_care": True}}, "toolu_bad")),
        response("tool_use", submission({"is_primary_care": True}, "toolu_good")),
    )

    findings = run(client)

    assert findings.is_primary_care is True
    error_result = client.sent[1][-1]["content"][0]
    assert error_result["type"] == "tool_result"
    assert error_result["tool_use_id"] == "toolu_bad"
    assert error_result["is_error"] is True


def test_gives_up_after_one_nudge_without_a_submission():
    text = SimpleNamespace(type="text", text="Done researching.")
    client = FakeClaude(response("end_turn", text), response("end_turn", text))

    with pytest.raises(agent.EnrichmentError):
        run(client)
    assert len(client.sent) == 2


def test_pause_turn_resumes_the_same_conversation():
    search = SimpleNamespace(type="server_tool_use", name="web_search", id="srvtoolu_1", input={})
    client = FakeClaude(
        response("pause_turn", search),
        response("tool_use", submission({"practice_type": "Family medicine practice"})),
    )

    findings = run(client)

    assert findings.practice_type == "Family medicine practice"
    # Resuming re-sends the paused assistant turn as-is, without adding a user message.
    assert client.sent[1][-1]["role"] == "assistant"
