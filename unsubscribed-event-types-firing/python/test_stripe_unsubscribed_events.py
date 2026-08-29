from stripe_unsubscribed_events import classify

SUBSCRIBED = ["payment_intent.succeeded", "invoice.paid"]


def test_a_subscribed_type_is_covered():
    state, _ = classify("invoice.paid", 12, SUBSCRIBED)
    assert state == "covered"


def test_a_type_with_no_sibling_subscribed_is_missed():
    state, detail = classify("charge.dispute.created", 7, SUBSCRIBED)
    assert state == "missed"
    assert "7 time(s)" in detail
    assert "charge" in detail


def test_a_sibling_subscription_does_not_cover_the_type():
    # payment_intent.succeeded is subscribed; the failure is not implied by it.
    state, detail = classify("payment_intent.payment_failed", 31, SUBSCRIBED)
    assert state == "near-miss"
    assert "payment_intent.succeeded" in detail


def test_a_namespace_pattern_is_not_a_subscription():
    # Only the literal * is a wildcard. "payment_intent.*" matches nothing.
    state, _ = classify("payment_intent.succeeded", 5, ["payment_intent.*"])
    assert state != "covered"
    assert state == "near-miss"


def test_a_wildcard_covers_everything():
    state, _ = classify("radar.early_fraud_warning.created", 2, ["*"])
    assert state == "wildcard"


def test_a_type_that_never_fired_is_not_a_gap():
    state, _ = classify("invoice.paid", 0, [])
    assert state == "unseen"
