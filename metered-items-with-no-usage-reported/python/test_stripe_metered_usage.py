from stripe_metered_usage import verdict


def test_usage_present_is_reporting():
    state, detail = verdict(41208, 12, 300.0, 0)
    assert state == "reporting"
    assert "41,208" in detail


def test_a_fresh_period_is_not_a_fault():
    # Zero usage two hours into a period is normal on almost any product.
    assert verdict(0, 0, 2.0, 0)[0] == "early"
    assert verdict(0, 0, 6.0, 0)[0] == "silent"


def test_no_summaries_points_at_the_event_name():
    state, detail = verdict(0, 0, 240.0, 0)
    assert state == "silent"
    assert "event_name" in detail


def test_rows_that_aggregate_to_zero_point_at_the_value_key():
    # The events matched the meter and the customer. Only the value did not.
    state, detail = verdict(0, 9, 240.0, 0)
    assert state == "zero-valued"
    assert "value_settings.event_payload_key" in detail


def test_already_billed_cycles_escalate_and_keep_the_cause():
    state, detail = verdict(0, 9, 240.0, 4)
    assert state == "billed-zero"
    assert "4 closed invoice(s)" in detail
    assert "value_settings.event_payload_key" in detail
