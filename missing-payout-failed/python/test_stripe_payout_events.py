from stripe_payout_events import verdict

BOTH = ["payout.paid", "payout.failed", "payment_intent.succeeded"]


def test_both_payout_events_subscribed_is_covered():
    state, _ = verdict(BOTH, 0)
    assert state == "covered"


def test_missing_subscription_with_failures_is_an_incident():
    state, detail = verdict(["payout.paid"], 3)
    assert state == "blind"
    assert "3 payout(s)" in detail


def test_missing_subscription_with_no_failures_is_only_a_gap():
    # Same configuration, different urgency. Collapsing these two loses the
    # distinction between a ticket and a page.
    state, _ = verdict(["payout.paid"], 0)
    assert state == "unsubscribed"


def test_failure_without_the_success_is_flagged_as_partial():
    state, _ = verdict(["payout.failed"], 0)
    assert state == "partial"


def test_a_wildcard_covers_it_but_is_named_as_such():
    state, detail = verdict(["*"], 0)
    assert state == "wildcard"
    assert "every" in detail
