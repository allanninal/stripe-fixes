from stripe_stale_intents import classify

NOW = 1_800_000_000
DAY = 86400


def pi(status="requires_payment_method", age_d=30, err=None):
    out = {"status": status, "created": NOW - age_d * DAY}
    if err is not None:
        out["last_payment_error"] = err
    return out


def test_old_intent_with_no_error_was_never_attempted():
    state, detail = classify(pi(age_d=30), NOW)
    assert state == "never-attempted"
    assert "no payment method" in detail


def test_old_intent_with_an_error_is_a_missing_retry():
    # Same status, opposite fix: this customer tried and was turned down.
    state, detail = classify(pi(age_d=30, err={"decline_code": "insufficient_funds"}), NOW)
    assert state == "declined"
    assert "insufficient_funds" in detail


def test_requires_confirmation_is_the_servers_omission():
    state, detail = classify(pi(status="requires_confirmation", age_d=30), NOW)
    assert state == "unconfirmed"
    assert "confirm" in detail


def test_a_two_day_old_intent_is_still_live():
    assert classify(pi(age_d=2), NOW)[0] == "recent"


def test_succeeded_intents_are_not_counted():
    assert classify(pi(status="succeeded"), NOW)[0] == "other"
