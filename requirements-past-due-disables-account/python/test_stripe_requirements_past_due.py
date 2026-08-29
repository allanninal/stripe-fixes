from stripe_requirements_past_due import classify

NOW = 1800000000
DAY = 86400


def test_past_due_wins_over_the_array_that_contains_it():
    # past_due is a strict subset of currently_due. Reading the outer array first
    # is exactly the bug this check exists to avoid.
    state, detail = classify({
        "past_due": ["company.tax_id"],
        "currently_due": ["company.tax_id", "business_profile.url"],
        "current_deadline": NOW - 3 * DAY,
    }, NOW)
    assert state == "past-due"
    assert "company.tax_id" in detail


def test_near_deadline_is_separated_from_a_distant_one():
    reqs = {"currently_due": ["company.tax_id"], "current_deadline": NOW + 20 * DAY}
    assert classify(reqs, NOW)[0] == "due"
    reqs["current_deadline"] = NOW + 13 * DAY
    assert classify(reqs, NOW)[0] == "deadline"


def test_fourteen_days_is_inside_the_window():
    reqs = {"currently_due": ["x"], "current_deadline": NOW + 14 * DAY}
    assert classify(reqs, NOW)[0] == "deadline"


def test_passed_deadline_without_past_due_is_still_reported():
    # Stripe moves the fields on its own schedule, so there is a gap where the
    # deadline is behind you and past_due is still empty.
    state, detail = classify(
        {"currently_due": ["x"], "current_deadline": NOW - 2 * DAY}, NOW)
    assert state == "overdue"
    assert "expect past_due next" in detail


def test_pending_verification_is_not_work_for_anyone():
    state, _ = classify({"pending_verification": ["individual.id_number"]}, NOW)
    assert state == "pending"


def test_eventually_due_alone_is_not_urgent_and_empty_is_clear():
    assert classify({"eventually_due": ["company.tax_id"]}, NOW)[0] == "eventual"
    assert classify({}, NOW)[0] == "clear"
    assert classify(None, NOW)[0] == "clear"
