import pytest
from pydantic import ValidationError

from app.models import Findings


def test_submission_with_unexpected_shape_is_rejected_instead_of_silently_empty():
    with pytest.raises(ValidationError):
        Findings.model_validate({"findings": {"is_primary_care": True}})


def test_partial_submission_leaves_unknown_facts_null():
    findings = Findings.model_validate(
        {
            "is_primary_care": True,
            "languages": {
                "value": ["Spanish"],
                "source_url": "https://example.com/about",
                "quote": "Se habla español",
            },
        }
    )
    assert findings.languages.value == ["Spanish"]
    assert findings.booking_url.value is None
    assert findings.insurance_plans == []


def test_sourced_models_list_the_value_before_its_evidence():
    # The agent reads this schema; with the evidence fields first it misplaced "value" (models.py).
    definitions = Findings.model_json_schema()["$defs"]
    for name in ("Fact_str_", "Fact_bool_", "InsurancePlan", "YearsInBusiness"):
        assert list(definitions[name]["properties"])[-2:] == ["source_url", "quote"], name
