from stripe_expired_capture_refunds import classify


def refund(reason="requested_by_customer"):
    out = {"id": "re_1", "amount": 4900, "currency": "usd", "charge": "ch_1"}
    if reason is not None:
        out["reason"] = reason
    return out


def test_expired_reason_with_an_uncaptured_charge_is_confirmed():
    state, detail = classify(refund("expired_uncaptured_charge"), {"captured": False})
    assert state == "expired"
    assert "no customer asked" in detail


def test_expired_reason_without_the_charge_is_only_a_candidate():
    # The whole point: unverified is not the same finding as verified.
    state, detail = classify(refund("expired_uncaptured_charge"))
    assert state == "expired-unverified"
    assert "unconfirmed" in detail


def test_expired_reason_on_a_captured_charge_is_flagged_not_counted():
    state, detail = classify(refund("expired_uncaptured_charge"), {"captured": True})
    assert state == "inconsistent"
    assert "captured=True" in detail


def test_a_customer_refund_stays_in_the_rate():
    state, detail = classify(refund("requested_by_customer"), {"captured": True})
    assert state == "customer"
    assert "refund rate" in detail


def test_a_refund_with_no_reason_is_not_treated_as_expired():
    assert classify(refund(None))[0] == "unlabelled"
