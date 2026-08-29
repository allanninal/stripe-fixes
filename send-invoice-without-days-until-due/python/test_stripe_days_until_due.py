from stripe_days_until_due import verdict


def test_charge_automatically_is_not_a_finding():
    # days_until_due is rejected for charge_automatically, so a null there is
    # correct rather than missing.
    state, detail = verdict("charge_automatically", None, 30, 0)
    assert state == "automatic"
    assert "does not apply" in detail


def test_null_terms_with_no_invoices_yet_is_unanchored():
    state, detail = verdict("send_invoice", None, 30, 0)
    assert state == "unanchored"
    assert "can never age" in detail


def test_null_terms_with_undated_invoices_names_the_damage():
    state, detail = verdict("send_invoice", None, 30, 7)
    assert state == "undated"
    assert "7" in detail


def test_zero_days_is_a_real_term_not_a_missing_one():
    # The whole reason the null check is explicit: `if not days_until_due`
    # would report due-on-receipt as unconfigured.
    state, _ = verdict("send_invoice", 0, 30, 0)
    assert state == "on-receipt"


def test_terms_at_or_past_the_billing_period_overlap():
    assert verdict("send_invoice", 30, 30, 0)[0] == "overlapping"
    assert verdict("send_invoice", 29, 30, 0)[0] == "dated"


def test_an_unreadable_interval_does_not_invent_an_overlap():
    assert verdict("send_invoice", 45, None, 0)[0] == "dated"
