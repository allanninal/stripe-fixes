from stripe_event_version_boundary import exposure, label, verdict

NEW = "2025-09-30.clover"
OLD = "2024-09-30.acacia"


def ev(version, created):
    return {"api_version": version, "created": created}


def test_one_version_across_the_window_is_single():
    state, _ = verdict([ev(NEW, 300), ev(NEW, 200), ev(NEW, 100)])
    assert state == "single"


def test_a_missing_version_is_bucketed_not_dropped():
    # Dropping it removes the transition it produced, and the window reports
    # one clean shape when it has two.
    assert label(None) == label("") == "unreported"
    state, _ = verdict([ev(NEW, 300), ev(None, 200), ev(None, 100)])
    assert state == "boundary"


def test_a_clean_cut_reports_the_transition_timestamp():
    # Newest first, so the transition is the created of the oldest new-shape
    # event: the first moment the new version was in force.
    state, detail = verdict([ev(NEW, 300), ev(NEW, 200), ev(OLD, 100)])
    assert state == "boundary"
    assert "created=200" in detail
    assert OLD in detail and NEW in detail


def test_an_upgrade_that_was_rolled_back_is_not_a_clean_cut():
    state, detail = verdict([ev(OLD, 400), ev(NEW, 300), ev(NEW, 200), ev(OLD, 100)])
    assert state == "churn"
    assert "72 hour" in detail


def test_one_unpinned_endpoint_means_the_boundary_was_delivered():
    assert exposure([NEW, None])[0] == "inherited"
    assert exposure([NEW, ""])[0] == "inherited"
    assert exposure([NEW, OLD])[0] == "pinned"
    assert exposure([])[0] == "no-endpoints"
