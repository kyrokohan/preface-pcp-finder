"""What the enrichment agent reports about a practice.

Every fact carries the page it came from and a short verbatim quote so the navigator can judge
how far to trust it. `None` means "not found", never a guess.
"""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class StrictModel(BaseModel):
    # Every field is optional, so without this a submission shaped differently from the schema
    # (e.g. wrapped in {"findings": {...}}) would validate as all-null findings instead of failing.
    model_config = ConfigDict(extra="forbid")


class Fact(StrictModel, Generic[T]):
    value: T | None = None
    source_url: str | None = None
    quote: str | None = Field(
        default=None, description="Short verbatim quote (under 25 words) supporting the value"
    )


BookingPlatform = Literal[
    "zocdoc",
    "mychart",
    "athenahealth",
    "healow",
    "nexhealth",
    "solv",
    "onemedical",
    "kaiser",
    "practice_website_form",
    "phone_only",
    "other",
]


class InsurancePlan(StrictModel):
    name: str = Field(
        description="Canonical payer name from the list in the instructions when it matches, "
        "otherwise the plan name as written"
    )
    source_url: str | None = None
    quote: str | None = None


class YearsInBusiness(StrictModel):
    since_year: int | None = Field(
        default=None, description="Year the practice (or the lead physician's practice) began"
    )
    basis: Literal["practice_founded", "physician_experience", "npi_enumeration"] | None = None
    source_url: str | None = None
    quote: str | None = None


class Findings(StrictModel):
    is_primary_care: bool | None = Field(
        default=None,
        description="True for family/internal medicine, pediatrics, general practice or "
        "community clinics; false for specialists, urgent care and non-medical businesses",
    )
    practice_type: str | None = Field(
        default=None, description="e.g. 'Family medicine practice', 'Community health center'"
    )
    ages_served: str | None = Field(default=None, description="e.g. 'All ages', 'Adults 18+'")
    website: Fact[str] = Field(
        default_factory=Fact[str], description="The practice's own website, if found"
    )
    booking_url: Fact[str] = Field(
        default_factory=Fact[str],
        description="URL a patient uses to book or request an appointment online",
    )
    booking_platform: BookingPlatform | None = None
    next_available: Fact[str] = Field(
        default_factory=Fact[str], description="Published next available appointment, as stated"
    )
    same_day_or_walk_in: Fact[bool] = Field(default_factory=Fact[bool])
    availability_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Other published availability, e.g. evening/weekend appointments",
    )
    accepting_new_patients: Fact[bool] = Field(default_factory=Fact[bool])
    telehealth: Fact[bool] = Field(default_factory=Fact[bool])
    languages: Fact[list[str]] = Field(default_factory=Fact[list[str]])
    insurance_plans: list[InsurancePlan] = Field(default_factory=list)
    insurance_notes: Fact[str] = Field(
        default_factory=Fact[str],
        description="Caveats such as HMO only, through a specific medical group, call to verify",
    )
    years_in_business: YearsInBusiness = Field(default_factory=YearsInBusiness)
    summary: str | None = Field(
        default=None,
        description="One or two sentences the navigator should know before calling",
    )
