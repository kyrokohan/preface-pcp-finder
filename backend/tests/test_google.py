from app.google import haversine_mi, is_clearly_not_pcp


def test_haversine_matches_known_distance():
    # LA City Hall to Santa Monica Pier is roughly 14.8 miles as the crow flies.
    assert 14 < haversine_mi(34.0537, -118.2428, 34.0100, -118.4962) < 15.5


def test_drops_listings_that_are_clearly_not_primary_care():
    assert is_clearly_not_pcp("dentist", ["dentist", "health"])
    assert is_clearly_not_pcp(None, ["pharmacy", "store"])


def test_keeps_medical_listings_even_with_mixed_types():
    assert not is_clearly_not_pcp("doctor", ["doctor", "health"])
    assert not is_clearly_not_pcp("medical_clinic", ["medical_clinic", "pharmacy"])
