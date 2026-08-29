from stripe_dispute_deadlines import verdict

NOW = 1_700_000_000


def open_dispute(hours_left, **evidence):
    ev = {"due_by": NOW + int(hours_left * 3600)}
    ev.update(evidence)
    return {"id": "du_1", "status": "needs_response", "evidence_details": ev}


def test_deadline_inside_the_window_with_nothing_attached_is_critical():
    state, detail = verdict(open_dispute(6), NOW)
    assert state == "critical"
    assert "6.0" in detail


def test_seventy_two_hours_is_the_boundary_and_it_is_inclusive():
    # 72 must already fire. Waiting for 71 spends a third of what is left.
    assert verdict(open_dispute(72), NOW)[0] == "critical"
    assert verdict(open_dispute(72.1), NOW)[0] == "open"


def test_staged_evidence_that_was_never_submitted_is_its_own_state():
    state, detail = verdict(
        open_dispute(10, has_evidence=True, submission_count=0), NOW)
    assert state == "staged"
    assert "submission_count" in detail


def test_past_due_while_still_needing_a_response_is_forfeited():
    d = open_dispute(-1, past_due=True)
    state, detail = verdict(d, NOW)
    assert state == "forfeited"
    assert "fee" in detail


def test_under_review_is_answered_and_a_missing_due_by_is_not_silently_open():
    assert verdict({"status": "under_review"}, NOW)[0] == "submitted"
    assert verdict({"status": "needs_response", "evidence_details": {}}, NOW)[0] == "unknown"
    assert verdict({"status": "sleeping"}, NOW)[0] == "unknown"
