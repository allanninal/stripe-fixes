from stripe_payment_link_limits import verdict


def test_a_link_with_no_restrictions_is_uncapped():
    assert verdict(None)[0] == "uncapped"
    assert verdict({})[0] == "uncapped"


def test_a_link_well_inside_its_cap_has_headroom():
    state, detail = verdict({"completed_sessions": {"limit": 200, "count": 42}})
    assert state == "headroom"
    assert "42 of 200" in detail


def test_a_link_at_ninety_percent_is_the_one_worth_catching():
    state, detail = verdict({"completed_sessions": {"limit": 100, "count": 92}})
    assert state == "near-limit"
    assert "closes itself" in detail


def test_an_exhausted_link_with_no_traffic_is_only_housekeeping():
    assert verdict({"completed_sessions": {"limit": 50, "count": 50}})[0] == "exhausted"


def test_an_exhausted_link_still_being_clicked_is_lost_revenue():
    state, detail = verdict({"completed_sessions": {"limit": 50, "count": 50}}, 18)
    assert state == "exhausted-in-use"
    assert "18 customer(s)" in detail


def test_a_missing_counter_is_not_read_as_zero():
    # Reading absent as zero would report full headroom on the one link the
    # response did not describe.
    assert verdict({"completed_sessions": {"limit": 50}})[0] == "unknown"
