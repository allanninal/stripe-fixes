from stripe_sca_stuck_subs import intent_of, verdict


def legacy(intent):
    return {"id": "sub_1", "status": "incomplete",
            "latest_invoice": {"id": "in_1", "payment_intent": intent}}


def basil(intent):
    return {"id": "sub_1", "status": "incomplete",
            "latest_invoice": {"id": "in_1",
                               "payments": {"data": [{"payment": {"payment_intent": intent}}]}}}


def test_an_unanswered_challenge_is_named_as_one():
    sub = legacy({"status": "requires_action", "next_action": {"type": "use_stripe_sdk"}})
    state, detail = verdict(sub)
    assert state == "authentication"
    assert "use_stripe_sdk" in detail
    assert "still live" in detail


def test_the_intent_is_found_on_the_basil_shape_too():
    intent = {"status": "requires_action", "next_action": {"type": "redirect_to_url"}}
    assert intent_of(basil(intent)["latest_invoice"]) == intent
    assert verdict(basil(intent))[0] == "authentication"


def test_a_declined_card_is_not_reported_as_an_authentication_problem():
    sub = legacy({"status": "requires_payment_method",
                  "last_payment_error": {"decline_code": "insufficient_funds"}})
    state, detail = verdict(sub)
    assert state == "declined"
    assert "insufficient_funds" in detail


def test_an_unreadable_invoice_is_not_a_healthy_one():
    sub = {"id": "sub_1", "status": "incomplete", "latest_invoice": "in_1"}
    state, detail = verdict(sub)
    assert state == "unexpanded"
    assert "basil" in detail


def test_requires_action_with_nothing_to_do_is_its_own_state():
    assert verdict(legacy({"status": "requires_action"}))[0] == "no-next-action"
