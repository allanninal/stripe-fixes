from stripe_dispute_events import verdict


def test_no_dispute_subscription_with_disputes_already_filed():
    state, detail = verdict(["charge.succeeded"], 7, 0)
    assert state == "blind"
    assert "7" in detail


def test_no_dispute_subscription_and_no_disputes_yet_is_only_a_gap():
    state, detail = verdict(["charge.succeeded"], 0, 0)
    assert state == "unsubscribed"
    assert "gap" in detail


def test_disputes_covered_but_fraud_warnings_are_not():
    state, detail = verdict(["charge.dispute.created"], 3, 12)
    assert state == "fraud-blind"
    assert "12" in detail


def test_disputes_covered_with_no_warnings_seen_is_still_incomplete():
    state, _ = verdict(["charge.dispute.created"], 3, 0)
    assert state == "dispute-only"


def test_both_opening_signals_without_the_closing_one():
    state, detail = verdict(["charge.dispute.created",
                             "radar.early_fraud_warning.created"], 3, 2)
    assert state == "partial"
    assert "charge.dispute.closed" in detail


def test_all_three_is_covered():
    state, _ = verdict(["charge.dispute.created", "charge.dispute.closed",
                        "radar.early_fraud_warning.created"], 3, 2)
    assert state == "covered"


def test_a_wildcard_is_reported_before_anything_else():
    state, _ = verdict(["*"], 7, 12)
    assert state == "wildcard"
