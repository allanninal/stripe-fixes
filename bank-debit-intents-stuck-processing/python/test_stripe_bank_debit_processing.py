from stripe_bank_debit_processing import classify

NOW = 1_700_000_000
DAY = 86400


def intent(types, age_days, status="processing"):
    return {
        "status": status,
        "payment_method_types": types,
        "created": NOW - int(age_days * DAY),
    }


def test_settled_intents_are_ignored():
    state, _ = classify(intent(["us_bank_account"], 30, status="succeeded"), NOW)
    assert state == "not_processing"


def test_ach_inside_its_window_is_settling():
    state, detail = classify(intent(["us_bank_account"], 3), NOW)
    assert state == "settling"
    assert "us_bank_account" in detail


def test_sepa_at_five_days_is_still_settling():
    # A single seven-day rule would be wrong here in one direction and wrong
    # about the ACH case below in the other.
    assert classify(intent(["sepa_debit"], 5), NOW)[0] == "settling"


def test_ach_at_nine_days_is_stuck():
    state, detail = classify(intent(["us_bank_account"], 9), NOW)
    assert state == "stuck"
    assert "not settlement taking its time" in detail


def test_several_debit_types_take_the_most_generous_window():
    state, _ = classify(intent(["us_bank_account", "sepa_debit"], 6.5), NOW)
    assert state == "settling"


def test_a_card_left_processing_is_a_different_failure():
    state, detail = classify(intent(["card"], 4), NOW)
    assert state == "non_debit"
    assert "confirmation never completed" in detail
