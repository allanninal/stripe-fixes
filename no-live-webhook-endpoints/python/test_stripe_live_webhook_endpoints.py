from stripe_live_webhook_endpoints import verdict, is_livemode


def test_no_endpoints_with_payments_is_the_outage():
    state, detail = verdict([], 47, True)
    assert state == "blind"
    assert "47" in detail


def test_no_endpoints_and_no_traffic_is_a_gap_not_an_outage():
    state, detail = verdict([], 0, True)
    assert state == "empty"
    assert "before the first real payment" in detail


def test_endpoints_that_are_all_disabled_deliver_nothing():
    state, _ = verdict([{"status": "disabled"}, {"status": "disabled"}], 12, True)
    assert state == "all-disabled"


def test_a_healthy_test_mode_is_not_a_pass():
    state, detail = verdict([{"status": "enabled"}], 12, False)
    assert state == "test-mode"
    assert "live restricted key" in detail


def test_an_enabled_live_endpoint_is_covered():
    state, _ = verdict([{"status": "enabled"}], 12, True)
    assert state == "covered"


def test_missing_status_does_not_count_as_enabled():
    state, _ = verdict([{}], 0, True)
    assert state == "all-disabled"


def test_key_prefix_decides_the_mode():
    assert is_livemode("rk_live_abc") is True
    assert is_livemode("rk_test_abc") is False
