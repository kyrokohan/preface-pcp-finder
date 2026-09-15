"""What the enrichment agent reports about a practice.

Each researched fact carries the page it came from and a short verbatim quote. The UI doesn't
show them: requiring them keeps the agent grounded in what it actually read, and they stay in the
stored profile for audits. `None` means "not found", never a guess.

The field descriptions are part of the agent's instructions (it reads them in the submit_findings
schema), so they define exactly what counts as each value.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Quote = Annotated[
    str | None,
    Field(
        description="Verbatim text under 25 words that on its own states the value; "
        "null when the value is null"
    ),
]


class StrictModel(BaseModel):
    # Every field is optional, so without this a submission shaped differently from the schema
    # (e.g. wrapped in {"findings": {...}}) would validate as all-null findings instead of failing.
    model_config = ConfigDict(extra="forbid")


# The evidence rule is also enforced here, not just in the prompt: a value that arrives without a
# quote is dropped, so an unsupported fact never reaches the navigator.
#
# Sourced models list their value before source_url and quote. Field order is part of what Claude
# reads: with the value last, it wrapped whole submissions in a top-level "value" key and had to
# resubmit (4 of 4 test runs, about twice as slow); with the value first, 2 of 2 were valid.
class Fact[T](StrictModel):
    value: T | None = None
    source_url: str | None = None
    quote: Quote = None

    @model_validator(mode="after")
    def _drop_unquoted_value(self):
        if not self.quote:
            self.value = None
        return self


class InsurancePlan(StrictModel):
    name: str = Field(description="Payer name, normalized as the instructions describe")
    source_url: str | None = None
    quote: Quote = None


class YearsInBusiness(StrictModel):
    since_year: int | None = Field(
        default=None,
        description="From an explicit statement, in this order: the year the practice or "
        "organization running this location opened; for a solo physician, current year minus "
        "stated years in practice ('over 20 years' in 2026 -> 2006); the NPI enumeration date. "
        "Never school, residency, board or license dates.",
    )
    basis: Literal["practice_founded", "physician_experience", "npi_enumeration"] | None = Field(
        default=None, description="Which of those three rules since_year came from"
    )
    source_url: str | None = None
    quote: Quote = None

    @model_validator(mode="after")
    def _drop_unquoted_year(self):
        if not self.quote:
            self.since_year = None
            self.basis = None
        return self


class Findings(StrictModel):
    is_primary_care: bool | None = Field(
        default=None,
        description="True for ongoing primary care: family or internal medicine, pediatrics, "
        "general practice, geriatrics, community health centers. False only with evidence it is "
        "something else (urgent care only, specialist, hospital or ER, non-medical), because "
        "false hides the practice from the list. Null if unclear.",
    )
    practice_type: str | None = Field(
        default=None,
        description="2-5 words, e.g. 'Family medicine', 'Community health center (FQHC)'",
    )
    ages_served: str | None = Field(
        default=None,
        description="Only as a source states it, e.g. 'Adults 18+'; a specialty doesn't imply "
        "ages; otherwise null",
    )
    website: Fact[str] = Field(
        default_factory=Fact[str], description="The practice's own website, if found"
    )
    booking_url: Fact[str] = Field(
        default_factory=Fact[str],
        description="Link, seen on a page, where a patient can schedule or request an appointment "
        "here without an existing account: online scheduler, appointment request form, or a "
        "bookable Zocdoc-style profile for this provider at this address. Not contact pages or "
        "patient-portal logins.",
    )
    next_available: Fact[str] = Field(
        default_factory=Fact[str],
        description="A specific opening shown on a page, as a date such as 'Thu Sep 18' (convert "
        "'tomorrow' using today's date). Not general claims like 'appointments available'.",
    )
    same_day_or_walk_in: Fact[bool] = Field(
        default_factory=Fact[bool],
        description="Stated walk-ins or same-day primary care visits here; false only if "
        "appointments are stated as required",
    )
    availability_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Availability not covered by the other fields or regular office hours, "
        "e.g. 'Evening clinic on Tuesdays'; otherwise null",
    )
    accepting_new_patients: Fact[bool] = Field(
        default_factory=Fact[bool],
        description="From an explicit statement about new patients here, e.g. 'accepting new "
        "patients' or 'panel closed'. Welcome or mission language and sign-up forms don't count.",
    )
    telehealth: Fact[bool] = Field(
        default_factory=Fact[bool],
        description="This practice's own clinicians offer video or phone visits; not a health "
        "system's separate virtual or on-demand service",
    )
    languages: Fact[list[str]] = Field(
        default_factory=Fact[list[str]],
        description="Languages this location's clinicians or staff speak, plain names only; "
        "English only if listed; not interpreter services",
    )
    insurance_plans: list[InsurancePlan] = Field(
        default_factory=list,
        description="One entry per payer. Use the practice's own list when it has one, otherwise "
        "directory lists.",
    )
    insurance_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Plan restrictions a navigator must know, e.g. 'HMO patients only through "
        "Regal Medical Group'; null if none (don't add generic 'call to verify' advice)",
    )
    years_in_business: YearsInBusiness = Field(default_factory=YearsInBusiness)
    summary: str | None = Field(
        default=None,
        description="One short sentence the navigator must know that no other field says, e.g. "
        "closed, moved or doctor retired; otherwise null",
    )

    @model_validator(mode="after")
    def _drop_unquoted_plans(self):
        self.insurance_plans = [plan for plan in self.insurance_plans if plan.quote]
        return self
