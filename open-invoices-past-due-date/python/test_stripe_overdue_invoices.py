from stripe_overdue_invoices import verdict


def test_within_terms_is_current():
    state, detail = verdict(-4.0, 25000)
    assert state == "current"
    assert "4.0" in detail


def test_the_due_date_itself_is_already_overdue():
    assert verdict(-0.1, 25000)[0] == "current"
    assert verdict(0.0, 25000)[0] == "overdue"


def test_thirty_and_sixty_days_are_the_two_boundaries():
    assert verdict(29.9, 25000)[0] == "overdue"
    assert verdict(30.0, 25000)[0] == "stale"
    assert verdict(59.9, 25000)[0] == "stale"
    state, detail = verdict(60.0, 25000)
    assert state == "abandoned"
    assert "nothing automated will chase" in detail


def test_no_due_date_is_reported_rather_than_ignored():
    # It can never be overdue, which means no reminder will ever fire. Silence
    # here is how an invoice leaves the receivable report for good.
    state, _ = verdict(None, 25000)
    assert state == "undated"


def test_a_zero_balance_is_not_receivable():
    assert verdict(120.0, 0)[0] == "nothing_due"
