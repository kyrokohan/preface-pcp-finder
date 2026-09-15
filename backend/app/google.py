"""Google Maps Platform: ZIP geocoding and Places API (New) Text Search.

Places content (names, ratings, phones, hours) is fetched live on every search and never
persisted: the Places terms only allow storing place IDs.
"""

import math
from typing import Literal

import httpx
from pydantic import BaseModel

from .config import settings

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

FIELD_MASK = ",".join(
    f"places.{field}"
    for field in (
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "nationalPhoneNumber",
        "websiteUri",
        "rating",
        "userRatingCount",
        "currentOpeningHours",
        "businessStatus",
        "types",
        "primaryType",
        "googleMapsUri",
    )
)

QUERIES = {"adult": "primary care doctor", "child": "pediatrician"}

# Places has no "primary care" type, so this only drops listings that are clearly something
# else; the enrichment agent makes the finer primary-care call.
MEDICAL_TYPES = {"doctor", "medical_clinic", "medical_center", "hospital", "general_hospital"}
NON_PCP_TYPES = {
    "dentist",
    "dental_clinic",
    "pharmacy",
    "drugstore",
    "physiotherapist",
    "chiropractor",
    "medical_lab",
    "skin_care_clinic",
    "veterinary_care",
    "spa",
    "wellness_center",
}

METERS_PER_MILE = 1609.344
MAX_BIAS_RADIUS_M = 50_000
SERVICE_AREA_COUNTY = "Los Angeles County"


class GoogleApiError(Exception):
    pass


class ZipNotFound(Exception):
    pass


class OutsideServiceArea(Exception):
    pass


class Provider(BaseModel):
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    distance_mi: float
    phone: str | None
    website: str | None
    rating: float | None
    review_count: int
    open_now: bool | None
    hours: list[str]
    google_maps_url: str | None
    primary_type: str | None
    types: list[str]


def haversine_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_mi = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * earth_radius_mi * math.asin(math.sqrt(a))


def is_clearly_not_pcp(primary_type: str | None, types: list[str]) -> bool:
    if primary_type in NON_PCP_TYPES:
        return True
    type_set = set(types)
    return bool(type_set & NON_PCP_TYPES) and not (type_set & MEDICAL_TYPES)


def _require_key() -> str:
    if not settings.google_maps_api_key:
        raise GoogleApiError("GOOGLE_MAPS_API_KEY is not set")
    return settings.google_maps_api_key


async def geocode_zip(http: httpx.AsyncClient, zip_code: str) -> tuple[float, float]:
    response = await http.get(
        GEOCODE_URL,
        params={"components": f"postal_code:{zip_code}|country:US", "key": _require_key()},
    )
    data = response.json()
    status = data.get("status")
    if status == "ZERO_RESULTS":
        raise ZipNotFound(zip_code)
    if status != "OK":
        raise GoogleApiError(f"Geocoding failed: {data.get('error_message') or status}")

    result = data["results"][0]
    counties = {
        component["long_name"]
        for component in result["address_components"]
        if "administrative_area_level_2" in component["types"]
    }
    if SERVICE_AREA_COUNTY not in counties:
        raise OutsideServiceArea(zip_code)

    location = result["geometry"]["location"]
    return location["lat"], location["lng"]


async def search_providers(
    http: httpx.AsyncClient,
    lat: float,
    lng: float,
    radius_mi: float,
    age_group: Literal["adult", "child"],
) -> list[Provider]:
    body = {
        "textQuery": QUERIES[age_group],
        "pageSize": 20,
        "rankPreference": "DISTANCE",
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": min(radius_mi * METERS_PER_MILE, MAX_BIAS_RADIUS_M),
            }
        },
    }
    response = await http.post(
        TEXT_SEARCH_URL,
        json=body,
        headers={"X-Goog-Api-Key": _require_key(), "X-Goog-FieldMask": FIELD_MASK},
    )
    if response.status_code != 200:
        message = response.json().get("error", {}).get("message", response.text)
        raise GoogleApiError(f"Places search failed: {message}")

    providers = []
    for place in response.json().get("places", []):
        if place.get("businessStatus", "OPERATIONAL") != "OPERATIONAL":
            continue
        types = place.get("types", [])
        if is_clearly_not_pcp(place.get("primaryType"), types):
            continue
        location = place["location"]
        distance = haversine_mi(lat, lng, location["latitude"], location["longitude"])
        if distance > radius_mi:
            continue
        hours = place.get("currentOpeningHours", {})
        providers.append(
            Provider(
                place_id=place["id"],
                name=place["displayName"]["text"],
                address=place["formattedAddress"],
                lat=location["latitude"],
                lng=location["longitude"],
                distance_mi=round(distance, 2),
                phone=place.get("nationalPhoneNumber"),
                website=place.get("websiteUri"),
                rating=place.get("rating"),
                review_count=place.get("userRatingCount", 0),
                open_now=hours.get("openNow"),
                hours=hours.get("weekdayDescriptions", []),
                google_maps_url=place.get("googleMapsUri"),
                primary_type=place.get("primaryType"),
                types=types,
            )
        )
    return providers
