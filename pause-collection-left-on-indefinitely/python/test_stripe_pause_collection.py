from stripe_pause_collection import verdict

NOW = 1_800_000_000
DAY = 86400


def test_no_pause_is_collecting():
    assert verdict({"id": "sub_1"}, NOW)[0] == "collecting"
    assert verdict({"id": "sub_1", "pause_collection": None}, NOW)[0] == "collecting"


def test_indefinite_keep_as_draft_leaves_something_to_collect():
    state, detail = verdict(
        {"pause_collection": {"behavior": "keep_as_draft", "resumes_at": None}}, NOW)
    assert state == "indefinite"
    assert "drafts" in detail


def test_indefinite_void_throws_the_invoices_away():
    # Same pause, same duration, nothing left to finalise at the end of it.
    state, _ = verdict(
        {"pause_collection": {"behavior": "void", "resumes_at": None}}, NOW)
    assert state == "unrecoverable"


def test_a_future_resumes_at_is_a_pause_with_an_end():
    state, _ = verdict(
        {"pause_collection": {"behavior": "void", "resumes_at": NOW + 14 * DAY}}, NOW)
    assert state == "scheduled"


def test_a_past_resumes_at_still_paused_is_its_own_oddity():
    state, detail = verdict(
        {"pause_collection": {"behavior": "keep_as_draft",
                              "resumes_at": NOW - 30 * DAY}}, NOW)
    assert state == "overdue"
    assert "30 day(s)" in detail
