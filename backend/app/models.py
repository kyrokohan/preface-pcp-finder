"""What the enrichment agent reports about a practice.

Each researched fact carries the page it came from and a short verbatim quote. The UI doesn't
show them: requiring them keeps the agent grounded in what it actually read, and they stay in the
stored profile for audits. `None` means "not found", never a guess.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Quote = Annotated[
    str | None, Field(description="Short verbatim quote (under 25 words) supporting the value")
]


class StrictModel(BaseModel):
    # Every field is optional, so without this a submission shaped differently from the schema
    # (e.g. wrapped in {"findings": {...}}) would validate as all-null findings instead of failing.
    model_config = ConfigDict(extra="forbid")


# Sourced models list their value before source_url and quote. Field order is part of what Claude
# reads: with the value last, it wrapped whole submissions in a top-level "value" key and had to
# resubmit (4 of 4 test runs, about twice as slow); with the value first, 2 of 2 were valid.
class Fact[T](StrictModel):
    value: T | None = None
    source_url: str | None = None
    quote: Quote = None


class InsurancePlan(StrictModel):
    name: str = Field(
        description="Canonical payer name from the list in the instructions when it matches, "
        "otherwise the plan name as written"
    )
    source_url: str | None = None
    quote: Quote = None


class YearsInBusiness(StrictModel):
    since_year: int | None = Field(
        default=None, description="Year the practice (or the lead physician's practice) began"
    )
    basis: Literal["practice_founded", "physician_experience", "npi_enumeration"] | None = None
    source_url: str | None = None
    quote: Quote = None


# The free-text descriptions below are deliberately strict: the card shows these fields as-is, so
# anything that repeats other fields or guesses makes it longer without helping the navigator.
class Findings(StrictModel):
    is_primary_care: bool | None = Field(
        default=None,
        description="True for family/internal medicine, pediatrics, general practice or "
        "community clinics; false for specialists, urgent care and non-medical businesses",
    )
    practice_type: str | None = Field(
        default=None, description="A few words, e.g. 'Family medicine practice'"
    )
    ages_served: str | None = Field(
        default=None,
        description="Only if the practice states it, e.g. 'Adults 18+', 'All ages'; otherwise null",
    )
    website: Fact[str] = Field(
        default_factory=Fact[str], description="The practice's own website, if found"
    )
    booking_url: Fact[str] = Field(
        default_factory=Fact[str],
        description="URL a patient uses to book or request an appointment online",
    )
    next_available: Fact[str] = Field(
        default_factory=Fact[str], description="Published next available appointment, as stated"
    )
    same_day_or_walk_in: Fact[bool] = Field(default_factory=Fact[bool])
    availability_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Availability not covered by the other fields or regular office hours, "
        "e.g. 'Evening clinic on Tuesdays'; otherwise null",
    )
    accepting_new_patients: Fact[bool] = Field(default_factory=Fact[bool])
    telehealth: Fact[bool] = Field(default_factory=Fact[bool])
    languages: Fact[list[str]] = Field(default_factory=Fact[list[str]])
    insurance_plans: list[InsurancePlan] = Field(default_factory=list)
    insurance_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Plan restrictions a navigator must know, e.g. 'HMO patients only through "
        "Regal Medical Group'; null if none (don't add generic 'call to verify' advice)",
    )
    years_in_business: YearsInBusiness = Field(default_factory=YearsInBusiness)
    summary: str | None = Field(
        default=None,
        description="At most one short sentence with anything important the other fields "
        "don't already say; otherwise null",
    )
