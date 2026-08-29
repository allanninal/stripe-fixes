from stripe_incomplete_subs import WINDOW, verdict

NOW = 1_800_000_000


def test_a_minutes_old_subscription_is_not_an_alert():
    state, detail = verdict({"created": NOW - 1800}, NOW)
    assert state == "pending"
    assert "confirmation step" in detail


def test_hours_old_and_unconfirmed_is_the_finding():
    state, detail = verdict({"created": NOW - 5 * 3600}, NOW)
    assert state == "stalled"
    assert "never confirmed" in detail


def test_the_last_two_hours_are_called_out_separately():
    # Still rescuable by a human, which is why it is not folded into "stalled".
    state, detail = verdict({"created": NOW - (WINDOW - 3600)}, NOW)
    assert state == "expiring"
    assert "left before" in detail


def test_exactly_23_hours_is_already_expired():
    # 82800 is the boundary Stripe documents, not a rounded-off guess.
    state, detail = verdict({"created": NOW - WINDOW}, NOW)
    assert state == "expired"
    assert "cannot be revived" in detail


def test_a_row_with_no_timestamp_is_not_silently_healthy():
    state, _ = verdict({}, NOW)
    assert state == "unknown"
