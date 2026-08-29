from stripe_manual_capture_holds import classify

NOW = 1_700_000_000


def hold(capture_before, status="requires_capture"):
    return {
        "capture_method": "manual",
        "status": status,
        "latest_charge": {
            "payment_method_details": {"card": {"capture_before": capture_before}},
        },
    }


def test_automatic_capture_is_not_this_problem():
    assert classify({"capture_method": "automatic"}, NOW)[0] == "automatic"


def test_a_hold_with_days_left_is_held():
    state, detail = classify(hold(NOW + 5 * 86400), NOW)
    assert state == "held"
    assert "120h" in detail


def test_a_hold_inside_the_warning_window_is_expiring():
    state, detail = classify(hold(NOW + 6 * 3600), NOW)
    assert state == "expiring"
    assert "released to the cardholder" in detail


def test_a_passed_deadline_is_expired_even_at_requires_capture():
    # Stripe's status can lag the network. The deadline is the fact.
    state, _ = classify(hold(NOW - 3600), NOW)
    assert state == "expired"


def test_missing_capture_before_is_unknown_not_safe():
    state, detail = classify(hold(None), NOW)
    assert state == "unknown"
    assert "not the same as far away" in detail


def test_automatic_cancellation_is_the_historical_loss():
    state, detail = classify({
        "capture_method": "manual",
        "status": "canceled",
        "cancellation_reason": "automatic",
    }, NOW)
    assert state == "lost"
    assert "expired uncaptured" in detail
