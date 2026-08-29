from stripe_webhook_health import verdict


def test_disabled_endpoint_is_reported_regardless_of_event_count():
    state, detail = verdict({"status": "disabled"}, 0)
    assert state == "disabled"
    assert "2xx" in detail


def test_enabled_and_quiet_is_healthy():
    state, _ = verdict({"status": "enabled"}, 0)
    assert state == "healthy"


def test_enabled_with_failures_is_its_own_state():
    # The point of the note: this is the window before Stripe disables it.
    state, detail = verdict({"status": "enabled"}, 12)
    assert state == "failing"
    assert "12" in detail


def test_unknown_status_is_not_silently_healthy():
    state, _ = verdict({"status": "paused"}, 0)
    assert state == "unknown"


def test_missing_status_is_not_silently_healthy():
    state, _ = verdict({}, 0)
    assert state == "unknown"
