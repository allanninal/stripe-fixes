from stripe_refund_health import classify

NOW = 1_800_000_000
DAY = 86400


def test_dead_card_is_reported_as_unretryable():
    state, detail = classify(
        {"status": "failed", "failure_reason": "expired_or_canceled_card"}, NOW)
    assert state == "failed"
    assert "out of band" in detail


def test_other_failures_say_the_money_reached_nobody():
    state, detail = classify(
        {"status": "failed", "failure_reason": "insufficient_funds"}, NOW)
    assert state == "failed"
    assert "reached nobody" in detail


def test_requires_action_is_not_a_failure():
    state, detail = classify({"status": "requires_action"}, NOW)
    assert state == "needs-action"
    assert "next_action" in detail


def test_pending_inside_the_window_is_normal():
    assert classify({"status": "pending", "created": NOW - 3 * DAY}, NOW)[0] == "pending"


def test_long_pending_is_stalled_and_unknown_status_is_not_settled():
    stalled, detail = classify(
        {"status": "pending", "created": NOW - 30 * DAY,
         "pending_reason": "charge_pending"}, NOW)
    assert stalled == "stalled"
    assert "charge_pending" in detail
    # A status Stripe adds later must not be read as money delivered.
    assert classify({"status": "reversed"}, NOW)[0] == "unknown"
