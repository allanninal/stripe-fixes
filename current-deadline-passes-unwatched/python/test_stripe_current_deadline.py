from stripe_current_deadline import cohort_day, days_left, horizon

# 2026-01-01T00:00:00Z, so every assertion below is about a date a human can check.
JAN1 = 1767225600


def account(deadline=None, due=()):
    return {"id": "acct_1",
            "requirements": {"current_deadline": deadline,
                             "currently_due": list(due)}}


def test_a_missing_deadline_is_not_a_date_far_away():
    assert days_left({"current_deadline": None}, JAN1) is None
    assert days_left({}, JAN1) is None


def test_days_left_counts_whole_days_and_goes_negative():
    assert days_left({"current_deadline": JAN1 + 10 * 86400}, JAN1) == 10
    assert days_left({"current_deadline": JAN1 + 86399}, JAN1) == 0
    assert days_left({"current_deadline": JAN1 - 86400}, JAN1) == -1


def test_cohort_day_groups_by_utc_date():
    # Two accounts an hour apart on the same UTC day are one cohort; the third
    # is a separate batch, and separate is the whole point of the grouping.
    assert cohort_day(JAN1) == "2026-01-01"
    assert cohort_day(JAN1 + 3600) == "2026-01-01"
    assert cohort_day(JAN1 + 86400) == "2026-01-02"
    assert cohort_day(None) is None


def test_inside_the_window_is_urgent_and_outside_it_is_scheduled():
    urgent, detail = horizon(account(JAN1 + 13 * 86400, ["company.tax_id"]), JAN1)
    assert urgent == "urgent"
    assert "company.tax_id" in detail
    assert "2026-01-14" in detail
    later, _ = horizon(account(JAN1 + 40 * 86400, ["company.tax_id"]), JAN1)
    assert later == "scheduled"


def test_a_passed_deadline_with_fields_due_is_an_incident_not_a_warning():
    state, detail = horizon(account(JAN1 - 3 * 86400, ["company.tax_id"]), JAN1)
    assert state == "enforced"
    assert "3 day(s) ago" in detail
    assert "already off" in detail


def test_a_deadline_with_nothing_due_asks_nobody_for_anything():
    state, detail = horizon(account(JAN1 + 5 * 86400, []), JAN1)
    assert state == "verifying"
    assert "nothing to collect" in detail


def test_fields_due_with_no_deadline_are_still_work():
    state, detail = horizon(account(None, ["business_profile.url"]), JAN1)
    assert state == "undated"
    assert "no date" in detail


def test_a_healthy_account_is_clear():
    assert horizon(account(None, []), JAN1)[0] == "clear"
