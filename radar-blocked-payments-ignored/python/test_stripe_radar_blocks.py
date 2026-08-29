from stripe_radar_blocks import classify


def charge(reason, type_="blocked", seller="Stopped"):
    return {"outcome": {"type": type_, "reason": reason, "seller_message": seller,
                        "network_status": "not_sent_to_network"}}


def test_custom_rule_is_named_as_yours():
    state, detail = classify(charge("rule", seller="Blocked by your rule"))
    assert state == "rule"
    assert "rule you wrote" in detail


def test_radar_threshold_is_not_confused_with_a_custom_rule():
    state, detail = classify(charge("highest_risk_level"))
    assert state == "risk"
    assert "not a rule of yours" in detail


def test_adaptive_acceptance_is_not_fraud():
    # The whole point of the note: this one is working correctly.
    state, detail = classify(charge("low_probability_of_authorization"))
    assert state == "adaptive"
    assert "Not fraud" in detail


def test_issuer_declines_are_a_different_investigation():
    assert classify(charge(None, type_="issuer_declined"))[0] == "not-blocked"


def test_missing_outcome_is_not_counted_as_blocked():
    assert classify({})[0] == "not-blocked"
