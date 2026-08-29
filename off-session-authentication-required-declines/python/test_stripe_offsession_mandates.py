from stripe_offsession_mandates import is_step_up_decline, has_mandate, verdict

GOOD_SI = {"status": "succeeded", "mandate": "mandate_123"}


def test_authentication_required_is_a_step_up_decline():
    assert is_step_up_decline({"last_payment_error":
                               {"code": "card_declined",
                                "decline_code": "authentication_required"}})


def test_authentication_not_handled_counts_too():
    assert is_step_up_decline({"last_payment_error":
                               {"decline_code": "authentication_not_handled"}})


def test_an_ordinary_decline_is_not_one():
    assert not is_step_up_decline({"last_payment_error":
                                   {"code": "card_declined",
                                    "decline_code": "insufficient_funds"}})


def test_a_succeeded_setup_intent_without_a_mandate_is_not_proof():
    # Green in the Dashboard, still not chargeable off-session.
    assert not has_mandate([{"status": "succeeded", "mandate": None}])


def test_an_abandoned_setup_intent_is_not_proof():
    assert not has_mandate([{"status": "requires_confirmation", "mandate": None}])


def test_declines_without_a_mandate_are_a_card_saving_bug():
    state, detail = verdict(4, 1, [{"status": "succeeded", "mandate": None}])
    assert state == "unmandated"
    assert "4" in detail


def test_declines_with_a_mandate_are_the_issuer_stepping_up():
    state, detail = verdict(2, 1, [GOOD_SI])
    assert state == "stepped_up"
    assert "on-session" in detail


def test_saved_cards_with_no_mandate_and_no_declines_yet_are_at_risk():
    state, _ = verdict(0, 3, [])
    assert state == "at_risk"


def test_saved_cards_behind_a_mandate_are_covered():
    assert verdict(0, 2, [GOOD_SI])[0] == "covered"


def test_a_customer_with_no_saved_cards_is_clear():
    assert verdict(0, 0, [])[0] == "clear"
