from stripe_dunning_exhausted import verdict


def test_dunning_still_running_is_not_a_finding():
    state, detail = verdict(2, 1.5, 9900)
    assert state == "retrying"
    assert "still running" in detail


def test_high_count_with_nothing_scheduled_is_exhausted():
    state, detail = verdict(8, None, 9900)
    assert state == "exhausted"
    assert "next_payment_attempt is null" in detail


def test_high_count_with_an_attempt_scheduled_is_a_hard_decline():
    # Same count, opposite meaning: retries are queued but only execute once a
    # new payment method appears, so this one needs an email, not a decision.
    assert verdict(8, 2.0, 9900)[0] == "stalled"
    assert verdict(3, None, 9900)[0] == "stopped_early"
    assert verdict(4, None, 9900)[0] == "exhausted"


def test_never_attempted_is_an_integration_problem():
    state, detail = verdict(0, None, 9900)
    assert state == "never_attempted"
    assert "integration problem" in detail


def test_a_settled_balance_is_not_dunning():
    assert verdict(8, None, 0)[0] == "nothing_due"
