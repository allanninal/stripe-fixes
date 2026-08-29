from stripe_dispute_rate import assess, rates


def test_no_successful_charges_is_not_an_infinite_rate():
    assert rates(3, 0, 0) == (None, None)
    state, detail = assess(3, 0, 0)
    assert state == "no_volume"
    assert "divide" in detail


def test_the_half_percent_vamp_line_is_inclusive():
    # 10 / 2000 is exactly 0.5%, which is already non-compliant.
    assert assess(10, 0, 2000)[0] == "watch"
    assert assess(9, 0, 2000)[0] == "clear"


def test_early_fraud_warnings_count_toward_the_visa_ratio():
    # 0.2% on disputes alone, 0.6% once EFWs join the numerator.
    dispute_rate, vamp_rate = rates(4, 8, 2000)
    assert dispute_rate < 0.005 < vamp_rate
    state, detail = assess(4, 8, 2000)
    assert state == "watch"
    assert "EFW" in detail


def test_a_high_ratio_under_the_count_floor_is_not_a_breach():
    # 3 countable events is below VAMP's floor of 5 and ECM's of 100,
    # so 1.5% here is a signal and not a programme risk.
    state, detail = assess(2, 1, 200)
    assert state == "below_floor"
    assert "VAMP needs 5" in detail


def test_the_bands_above_the_line_are_distinct():
    assert assess(16, 0, 2000)[0] == "excessive"   # 0.8%
    assert assess(40, 0, 2000)[0] == "program"     # 2.0%
    assert assess(11, 0, 2000)[0] == "watch"       # 0.55%
