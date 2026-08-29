from stripe_efw_actionable import classify

NOW = 1_700_000_000


def warning(**kw):
    w = {"id": "issfr_1", "actionable": True, "charge": "ch_1",
         "fraud_type": "made_with_stolen_card", "created": NOW - 3 * 86400}
    w.update(kw)
    return w


def charge(**kw):
    c = {"id": "ch_1", "amount": 4500, "currency": "usd", "amount_refunded": 0,
         "refunded": False, "disputed": False}
    c.update(kw)
    return c


def test_an_untouched_actionable_warning_is_flagged_with_its_age():
    state, detail = classify(warning(), charge(), NOW)
    assert state == "actionable"
    assert "3.0 day" in detail


def test_a_partial_refund_does_not_close_the_window():
    # The trap: amount_refunded is non-zero, so a naive check calls this done.
    state, detail = classify(warning(), charge(amount_refunded=500), NOW)
    assert state == "partial"
    assert "still actionable" in detail


def test_a_full_refund_is_the_outcome_this_check_exists_for():
    assert classify(warning(), charge(refunded=True, amount_refunded=4500), NOW)[0] == "refunded"
    # Refunded to the last minor unit without the boolean set is the same thing.
    assert classify(warning(), charge(amount_refunded=4500), NOW)[0] == "refunded"


def test_a_disputed_charge_is_past_the_window_not_pending_in_it():
    state, detail = classify(warning(), charge(disputed=True), NOW)
    assert state == "escalated"
    assert "fee" in detail


def test_the_actionable_flag_and_an_unreadable_charge_are_both_respected():
    assert classify(warning(actionable=False), charge(), NOW)[0] == "not_actionable"
    assert classify(warning(), None, NOW)[0] == "unknown"
