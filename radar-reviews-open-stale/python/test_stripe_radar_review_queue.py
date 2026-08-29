from stripe_radar_review_queue import rule_health, verdict


def test_fresh_review_is_just_open():
    state, detail = verdict(1.0, True)
    assert state == "open"
    assert "still inside the window" in detail


def test_three_days_is_the_stale_boundary():
    # Exactly three must already flag. A check that waits until day four has
    # spent nearly half the capture window before saying anything.
    assert verdict(2.9, True)[0] == "open"
    assert verdict(3.0, True)[0] == "stale"


def test_uncaptured_hold_expires_at_seven_days():
    state, detail = verdict(6.9, False)
    assert state == "expiring"
    assert "0.1 day(s)" in detail
    assert verdict(7.0, False)[0] == "lapsed"


def test_captured_charge_past_seven_days_is_critical():
    state, detail = verdict(9.0, True)
    assert state == "critical"
    assert "dispute window" in detail


def test_approval_rate_needs_a_sample_before_it_judges_the_rule():
    assert rule_health(19, 19)[0] == "insufficient"
    assert rule_health(20, 20)[0] == "overbroad"
    assert rule_health(16, 20)[0] == "wide"
    assert rule_health(8, 20)[0] == "earning"
