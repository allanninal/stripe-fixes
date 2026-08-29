from stripe_legacy_charges import classify


def test_charge_with_an_intent_is_modern():
    state, _ = classify({"payment_intent": "pi_123", "status": "succeeded"})
    assert state == "modern"


def test_absent_payment_intent_key_is_legacy_not_modern():
    # The field is sometimes absent rather than null. A membership test would
    # report a clean account here.
    state, detail = classify({"status": "succeeded"})
    assert state == "legacy"
    assert "3D Secure" in detail


def test_authentication_required_is_its_own_state():
    state, detail = classify({
        "payment_intent": None,
        "status": "failed",
        "outcome": {"type": "issuer_declined", "reason": "authentication_required"},
    })
    assert state == "unauthenticated"
    assert "declines again" in detail


def test_ordinary_decline_is_not_blamed_on_the_legacy_api():
    state, detail = classify({
        "payment_intent": None,
        "status": "failed",
        "outcome": {"type": "issuer_declined", "reason": "insufficient_funds"},
    })
    assert state == "legacy_declined"
    assert "insufficient_funds" in detail


def test_unrecognised_status_is_not_silently_counted_as_modern():
    state, _ = classify({"payment_intent": None, "status": "reversed"})
    assert state == "unknown"
