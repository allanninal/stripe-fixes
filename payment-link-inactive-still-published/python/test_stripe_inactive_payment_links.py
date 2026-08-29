from stripe_inactive_payment_links import verdict


def test_an_active_link_is_live():
    assert verdict(True, 12)[0] == "live"


def test_a_dead_link_with_recent_traffic_is_the_expensive_case():
    state, detail = verdict(False, 9)
    assert state == "dead-in-use"
    assert "9 time(s)" in detail


def test_an_inactive_message_softens_it_but_does_not_clear_it():
    state, detail = verdict(False, 9, "We moved to the new plan page")
    assert state == "dead-signposted"
    assert "new plan page" in detail


def test_a_dead_link_nobody_visits_is_only_housekeeping():
    assert verdict(False, 0)[0] == "dormant"


def test_a_missing_active_flag_is_not_read_as_deactivated():
    # `if not active` would call this dead and print a repair for a link that is
    # working perfectly. Absent is not false.
    assert verdict(None, 3)[0] == "unknown"
