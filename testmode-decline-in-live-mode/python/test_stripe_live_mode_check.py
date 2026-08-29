from stripe_live_mode_check import count_testmode_declines, verdict

LIVE = {"charges_enabled": True, "details_submitted": True}
BUSY = {"charges": 40, "payment_intents": 40, "customers": 12}


def test_counts_a_charge_that_only_names_it_in_outcome_reason():
    # failure_code is absent here; a counter reading one field misses this.
    charges = [{"outcome": {"reason": "testmode_decline"}}]
    assert count_testmode_declines(charges, []) == 1


def test_counts_an_intent_that_never_produced_a_charge():
    intents = [{"last_payment_error": {"code": "testmode_decline"}}]
    assert count_testmode_declines([], intents) == 1


def test_ordinary_declines_are_not_counted():
    charges = [{"failure_code": "card_declined",
                "outcome": {"reason": "insufficient_funds"}}]
    assert count_testmode_declines(charges, []) == 0


def test_a_test_key_short_circuits_every_other_rule():
    state, detail = verdict("test", {"charges_enabled": False}, {"testmode_declines": 9})
    assert state == "test_key"
    assert "live key" in detail


def test_unactivated_account_outranks_the_decline_count():
    # The declines are real, but the cause is the unfinished onboarding.
    state, _ = verdict("live", {"charges_enabled": False, "details_submitted": True},
                       {"testmode_declines": 3})
    assert state == "not_activated"


def test_declines_on_an_activated_account_name_the_count():
    state, detail = verdict("live", LIVE, dict(BUSY, testmode_declines=3))
    assert state == "test_cards_live"
    assert "3" in detail


def test_an_empty_live_account_is_not_healthy():
    state, _ = verdict("live", LIVE, {"testmode_declines": 0})
    assert state == "pointed_at_test"


def test_busy_and_clean_is_healthy():
    state, _ = verdict("live", LIVE, dict(BUSY, testmode_declines=0))
    assert state == "healthy"
