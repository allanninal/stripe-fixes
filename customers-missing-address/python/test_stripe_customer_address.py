from stripe_customer_address import address_state, verdict


def test_absent_address_is_missing():
    assert address_state({"id": "cus_1"}) == "missing"
    assert address_state({"address": None}) == "missing"


def test_address_object_with_every_field_null_is_missing_not_partial():
    # Stripe returns this shape. It renders as an address and resolves to nothing.
    empty = {"line1": None, "line2": None, "city": None,
             "state": None, "postal_code": None, "country": None}
    assert address_state({"address": empty}) == "missing"


def test_street_and_city_without_a_country_still_fails_tax():
    addr = {"line1": "12 Rue de Rivoli", "city": "Paris", "postal_code": "75001"}
    assert address_state({"address": addr}) == "no_country"


def test_country_without_a_postal_code_fails_avs():
    assert address_state({"address": {"country": "US", "city": "Denver"}}) == "no_postal_code"


def test_a_complete_address_is_complete():
    addr = {"line1": "1 Main St", "city": "Denver", "postal_code": "80202", "country": "US"}
    assert address_state({"address": addr}) == "complete"


def test_a_failed_finalization_outranks_any_percentage():
    state, detail = verdict(1000, 1, 0, 3)
    assert state == "failing"
    assert "3" in detail


def test_subscribed_customers_outrank_the_overall_share():
    # 4 of 1000 is a rounding error until you notice all four are billed monthly.
    state, _ = verdict(1000, 4, 4, 0)
    assert state == "billing"


def test_a_quarter_incomplete_is_a_collection_problem():
    assert verdict(1000, 249, 0, 0)[0] == "residue"
    assert verdict(1000, 250, 0, 0)[0] == "widespread"


def test_no_customers_is_not_silently_clear():
    assert verdict(0, 0, 0, 0)[0] == "unknown"
