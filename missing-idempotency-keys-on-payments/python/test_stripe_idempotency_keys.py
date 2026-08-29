from stripe_idempotency_keys import classify, verdict


def test_stripe_initiated_events_are_not_findings():
    # Both fields null. Stripe did this; there was never a key to send. Reading
    # only idempotency_key here flags every renewal invoice on the account.
    assert classify({"id": None, "idempotency_key": None}) == "stripe"
    assert classify(None) == "stripe"


def test_an_api_request_without_a_key_is_the_finding():
    assert classify({"id": "req_123", "idempotency_key": None}) == "unkeyed"


def test_an_api_request_with_a_key_is_clean():
    assert classify({"id": "req_123", "idempotency_key": "8f14e45f"}) == "keyed"


def test_a_bare_string_request_is_unreported_not_unkeyed():
    # Old API versions rendered `request` as a bare id string. The key is
    # unknown there, and counting it as absent invents a problem.
    assert classify("req_123") == "unreported"


def test_one_unkeyed_charge_is_already_exposed():
    state, detail = verdict("payment_intent.created", 400, 1)
    assert state == "exposed"
    assert "twice" in detail
    assert verdict("customer.created", 400, 1)[0] == "unkeyed"
    assert verdict("payment_intent.created", 400, 0)[0] == "keyed"
