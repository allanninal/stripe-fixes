from stripe_stranded_currency import classify


def test_settled_funds_with_no_destination_are_stranded():
    state, detail = classify({"currency": "eur", "amount": 41200}, 0, False, 0)
    assert state == "stranded"
    assert "41200" in detail


def test_pending_funds_with_no_destination_are_caught_early():
    # Nothing has settled yet, so this is the version of the problem you can
    # still fix before anybody has to reconcile around it.
    state, detail = classify({"currency": "eur", "amount": 0}, 8000, False, 0)
    assert state == "accruing"
    assert "stranded when it settles" in detail


def test_a_destination_that_never_pays_out_is_its_own_state():
    state, detail = classify({"currency": "gbp", "amount": 9500}, 0, True, 0)
    assert state == "stalled"
    assert "default_for_currency" in detail


def test_destination_and_payouts_is_healthy():
    state, _ = classify({"currency": "usd", "amount": 250000}, 40000, True, 14)
    assert state == "draining"


def test_empty_bucket_with_no_destination_is_not_a_problem():
    state, _ = classify({"currency": "eur", "amount": 0}, 0, False, 0)
    assert state == "clear"
