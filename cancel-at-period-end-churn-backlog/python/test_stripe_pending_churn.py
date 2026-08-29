from stripe_pending_churn import scheduled_end, verdict


def test_an_imminent_cliff_outranks_a_low_rate():
    # One cancellation in three days beats sixty spread over a year.
    state, detail = verdict(1, 400, 3)
    assert state == "imminent"
    assert "3 day(s)" in detail


def test_a_high_rate_far_out_is_a_trend():
    state, _ = verdict(60, 400, 200)
    assert state == "elevated"


def test_a_handful_far_out_is_just_a_backlog():
    state, detail = verdict(8, 400, 200)
    assert state == "backlog"
    assert "2.0%" in detail


def test_no_active_subscriptions_is_not_a_clean_bill_of_health():
    state, _ = verdict(0, 0, None)
    assert state == "empty"


def test_the_end_date_comes_from_the_item_not_from_canceled_at():
    sub = {"cancel_at_period_end": True, "canceled_at": 1,
           "items": {"data": [{"current_period_end": 999}]}}
    assert scheduled_end(sub) == 999
    assert scheduled_end({"cancel_at_period_end": False, "canceled_at": 1}) is None
