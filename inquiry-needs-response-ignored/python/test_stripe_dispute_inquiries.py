from stripe_dispute_inquiries import classify, family

NOW = 1_700_000_000


def inquiry(hours_left, **evidence):
    ev = {"due_by": NOW + int(hours_left * 3600)}
    ev.update(evidence)
    return {"id": "du_1", "status": "warning_needs_response",
            "evidence_details": ev}


def test_the_warning_family_is_the_inquiry_side_of_the_line():
    assert family("warning_needs_response") == "inquiry"
    assert family("warning_under_review") == "inquiry"
    assert family("warning_closed") == "inquiry"


def test_settled_chargebacks_stay_on_the_chargeback_side():
    # The shortcut this guards against: "anything not needs_response is done".
    assert family("won") == "chargeback"
    assert family("lost") == "chargeback"
    assert family("needs_response") == "chargeback"
    assert family("sleeping") == "unknown"


def test_an_open_inquiry_with_nothing_attached_reports_days_left():
    state, detail = classify(inquiry(240), NOW)
    assert state == "unanswered"
    assert "10.0 day" in detail


def test_seventy_two_hours_is_the_boundary_and_it_is_inclusive():
    assert classify(inquiry(72), NOW)[0] == "critical"
    assert classify(inquiry(72.1), NOW)[0] == "unanswered"


def test_staged_evidence_that_was_never_submitted_is_its_own_state():
    state, detail = classify(
        inquiry(240, has_evidence=True, submission_count=0), NOW)
    assert state == "staged"
    assert "submission_count" in detail
    # And an inquiry that really was answered is not confused with it.
    assert classify(inquiry(240, has_evidence=True, submission_count=1), NOW)[0] == "answered"


def test_an_escalated_dispute_is_not_reported_as_an_open_inquiry():
    state, detail = classify({"status": "needs_response"}, NOW)
    assert state == "escalated"
    assert "fee" in detail
    assert classify(inquiry(-1), NOW)[0] == "lapsing"
