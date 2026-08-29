from stripe_price_tax_behavior import verdict


def test_an_explicit_behavior_with_a_tax_code_is_ready():
    state, detail = verdict("exclusive", 0, "txcd_10000000", True)
    assert state == "ready"
    assert "txcd_10000000" in detail


def test_a_dormant_unspecified_price_can_be_fixed_in_place():
    state, detail = verdict("unspecified", 0, "txcd_10000000", False)
    assert state == "dormant"
    assert "still settable" in detail


def test_subscriptions_turn_the_fix_into_a_migration():
    state, detail = verdict("unspecified", 412, "txcd_10000000", False)
    assert state == "live"
    assert "412 active subscription(s)" in detail


def test_automatic_tax_makes_it_an_active_fault():
    # The same field, the same value, but now line items are rejected outright.
    state, detail = verdict("unspecified", 0, "txcd_10000000", True)
    assert state == "blocking"
    assert "cannot be added" in detail


def test_a_correct_behavior_on_a_product_with_no_tax_code_is_still_flagged():
    state, detail = verdict("inclusive", 0, None, False)
    assert state == "no-tax-code"
    assert "account default" in detail
