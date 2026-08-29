from stripe_missing_external_account import classify


def test_a_default_destination_is_the_healthy_case():
    state, detail = classify(
        [{"currency": "usd", "default_for_currency": True, "status": "verified"}],
        "usd")
    assert state == "attached"
    assert "default set for usd" in detail


def test_nothing_attached_separates_asked_from_never_asked():
    # Stripe asking and nobody collecting is a broken handoff. Stripe not asking
    # means the platform turned collection off and never built the other half.
    state, _ = classify([], "usd", ["external_account", "company.tax_id"])
    assert state == "none"
    assert classify([], "usd", ["company.tax_id"])[0] == "none-unrequested"


def test_attached_but_no_default_still_cannot_pay_out():
    state, detail = classify(
        [{"currency": "usd", "default_for_currency": False, "status": "verified"}],
        "usd")
    assert state == "no-default"
    assert "nowhere to go" in detail


def test_a_destination_in_the_wrong_currency_is_not_a_destination():
    state, detail = classify(
        [{"currency": "eur", "default_for_currency": True, "status": "verified"}],
        "usd")
    assert state == "wrong-currency"
    assert "usd" in detail


def test_case_does_not_decide_the_answer():
    # Stripe returns lowercase currencies, but an account object copied through a
    # cache or a spreadsheet may not.
    assert classify(
        [{"currency": "USD", "default_for_currency": True, "status": "verified"}],
        "USD")[0] == "attached"


def test_an_errored_default_is_reported_as_frozen_not_healthy():
    state, detail = classify(
        [{"currency": "usd", "default_for_currency": True, "status": "errored"}],
        "usd")
    assert state == "unusable"
    assert "have stopped" in detail
