from stripe_report_interval import freshness_state, interval_state

DAY = 86400
# A fixed availability window: data finalized up to this timestamp.
AVAIL_END = 1_756_000_000
AVAIL_START = AVAIL_END - 90 * DAY


def test_interval_inside_the_window_is_covered():
    state, detail = interval_state(AVAIL_END - 2 * DAY, AVAIL_END - DAY,
                                   AVAIL_START, AVAIL_END)
    assert state == "covered"
    assert "24.0 hour" in detail


def test_one_hour_past_availability_is_truncated_not_an_error():
    state, detail = interval_state(AVAIL_END - DAY, AVAIL_END + 3600,
                                   AVAIL_START, AVAIL_END)
    assert state == "truncated"
    assert "1.0 hour(s) past" in detail
    assert "succeeded" in detail


def test_landing_exactly_on_the_edge_is_a_warning_not_a_pass():
    # interval_end == data_available_end is not truncated, but it is the request
    # that gets truncated the night Stripe finalizes an hour later than usual.
    assert interval_state(AVAIL_START, AVAIL_END, AVAIL_START, AVAIL_END)[0] == "at_edge"
    assert interval_state(AVAIL_START, AVAIL_END - 1800,
                          AVAIL_START, AVAIL_END)[0] == "at_edge"
    # A full hour of margin is the boundary, and the boundary counts as covered.
    assert interval_state(AVAIL_START, AVAIL_END - 3600,
                          AVAIL_START, AVAIL_END)[0] == "covered"


def test_start_before_the_window_is_reported_separately():
    state, _ = interval_state(AVAIL_START - DAY, AVAIL_END - DAY,
                              AVAIL_START, AVAIL_END)
    assert state == "before_window"


def test_a_stale_window_is_stripes_problem_not_the_intervals():
    assert freshness_state(12.0)[0] == "fresh"
    assert freshness_state(35.9)[0] == "fresh"
    state, detail = freshness_state(36.0)
    assert state == "stale"
    assert "defer rather than retry" in detail
    assert freshness_state(None)[0] == "unknown"
