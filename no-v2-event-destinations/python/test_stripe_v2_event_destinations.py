from stripe_v2_event_destinations import verdict

THIN = {"id": "ed_1", "event_payload": "thin", "status": "enabled"}
SNAPSHOT = {"id": "ed_2", "event_payload": "snapshot", "status": "enabled"}


def test_an_enabled_thin_destination_is_all_that_is_needed():
    state, detail = verdict([THIN, SNAPSHOT], True)
    assert state == "covered"
    assert "ed_1" in detail


def test_a_thin_destination_that_is_disabled_delivers_nothing():
    dead = {"id": "ed_3", "event_payload": "thin", "status": "disabled",
            "status_details": "disabled after repeated 500s"}
    state, detail = verdict([dead], True)
    assert state == "disabled"
    assert "repeated 500s" in detail


def test_snapshot_destinations_do_not_count_as_coverage():
    # Three destinations, a row count that looks configured, and not one of them
    # can carry a thin event.
    state, detail = verdict([SNAPSHOT, SNAPSHOT, SNAPSHOT], True)
    assert state == "snapshot-only"
    assert "3 event destination(s)" in detail


def test_nothing_configured_while_a_v2_feature_runs_is_an_outage():
    state, detail = verdict([], True)
    assert state == "dropping"
    assert "delivered nowhere" in detail


def test_nothing_configured_and_no_v2_feature_is_only_a_gap():
    assert verdict([], False)[0] == "none"
    assert verdict(None, False)[0] == "none"
