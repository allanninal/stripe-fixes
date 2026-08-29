from stripe_past_due_subs import verdict

NOW = 1_800_000_000
DAY = 86400


def inv(days_old, attempts):
    return {"id": "in_1", "created": NOW - days_old * DAY, "attempt_count": attempts}


def test_a_fresh_invoice_with_attempts_is_live_dunning():
    state, detail = verdict({"latest_invoice": inv(3, 2)}, NOW)
    assert state == "dunning"
    assert "may recover" in detail


def test_an_old_invoice_is_parked_not_dunning():
    state, detail = verdict({"latest_invoice": inv(75, 4)}, NOW)
    assert state == "parked"
    assert "nothing further will happen" in detail


def test_zero_attempts_is_its_own_fault_not_a_retry_problem():
    # No attempt means nothing to retry: this is a missing payment method, and
    # changing the retry configuration would not touch it.
    state, detail = verdict({"latest_invoice": inv(40, 0)}, NOW)
    assert state == "never-attempted"
    assert "no payment method" in detail


def test_unexpanded_invoice_is_not_classified():
    state, detail = verdict({"latest_invoice": "in_1"}, NOW)
    assert state == "unknown"
    assert "expand" in detail


def test_invoice_without_a_timestamp_is_not_classified():
    state, _ = verdict({"latest_invoice": {"attempt_count": 3}}, NOW)
    assert state == "unknown"
