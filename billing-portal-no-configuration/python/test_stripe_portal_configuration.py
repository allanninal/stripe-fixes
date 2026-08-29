from stripe_portal_configuration import verdict

DEFAULT = {"id": "bpc_1", "is_default": True, "active": True}
EXPLICIT = {"id": "bpc_2", "is_default": False, "active": True}


def test_an_active_default_is_all_that_is_needed():
    state, detail = verdict([DEFAULT], 400)
    assert state == "configured"
    assert "bpc_1" in detail


def test_no_configuration_with_live_subscribers_is_an_outage():
    state, detail = verdict([], 400)
    assert state == "erroring"
    assert "400" in detail


def test_no_configuration_and_no_subscribers_is_only_waiting_to_break():
    assert verdict([], 0)[0] == "missing"


def test_an_explicit_only_setup_still_fails_without_the_id():
    # Counting the array would call this configured. Sessions created without a
    # configuration parameter still have no default to fall back to.
    state, detail = verdict([EXPLICIT], 400)
    assert state == "explicit-only"
    assert "bpc_2" in detail


def test_an_inactive_default_does_not_count():
    inactive = {"id": "bpc_3", "is_default": True, "active": False}
    assert verdict([inactive], 5)[0] == "inactive-default"
