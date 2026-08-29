from stripe_3ds_coverage import classify, coverage


def card_charge(risk="normal", three_d_secure=None, status="succeeded"):
    card = {"brand": "visa"}
    if three_d_secure is not None:
        card["three_d_secure"] = three_d_secure
    return {
        "id": "ch_1", "status": status, "amount": 9900, "currency": "usd",
        "outcome": {"risk_level": risk},
        "payment_method_details": {"type": "card", "card": card},
    }


def test_elevated_risk_with_no_authentication_is_the_finding():
    state, detail = classify(card_charge(risk="elevated"))
    assert state == "unprotected"
    assert "liability" in detail


def test_normal_risk_with_no_authentication_is_not_a_finding():
    # Ordinary traffic. Flagging it would bury the elevated-risk charges.
    state, detail = classify(card_charge(risk="normal"))
    assert state == "no_3ds"
    assert "share" in detail


def test_an_acknowledged_attempt_is_not_an_authentication():
    state, detail = classify(card_charge(
        risk="highest", three_d_secure={"result": "attempt_acknowledged"}))
    assert state == "attempted"
    assert "not" in detail
    assert classify(card_charge(
        risk="highest", three_d_secure={"result": "authenticated"}))[0] == "protected"


def test_non_card_and_unsettled_charges_are_out_of_scope():
    assert classify({"payment_method_details": {"type": "us_bank_account"}})[0] == "not_card"
    assert classify(card_charge(risk="highest", status="failed"))[0] == "not_settled"


def test_the_ten_percent_coverage_floor_is_inclusive():
    assert coverage(10, 100)[0] == "low"
    assert coverage(11, 100)[0] == "ok"
    assert coverage(0, 0)[0] == "no_volume"
