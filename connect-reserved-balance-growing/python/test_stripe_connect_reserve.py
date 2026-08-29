from stripe_connect_reserve import classify


def test_a_collection_transfer_outranks_everything_else():
    # The 180 day settlement already happened. Whatever is held now is a
    # secondary concern next to money that has permanently left.
    state, detail = classify({"currency": "usd", "amount": 4000}, 4000, 25000)
    assert state == "written-off"
    assert "connect_collection_transfer" in detail


def test_reserve_with_recent_activity_is_growing():
    state, detail = classify({"currency": "usd", "amount": 12000}, 9000, 0)
    assert state == "growing"
    assert "12000" in detail


def test_reserve_with_no_activity_is_the_dead_account_case():
    # Same positive amount, no movement behind it: nothing will release this
    # on its own, because the account that caused it has stopped trading.
    state, detail = classify({"currency": "usd", "amount": 12000}, 0, 0)
    assert state == "held"
    assert "180 day" in detail


def test_activity_with_nothing_held_is_normal_operation():
    state, _ = classify({"currency": "eur", "amount": 0}, 30000, 0)
    assert state == "settled"


def test_missing_amount_is_not_silently_clear():
    state, _ = classify({"currency": "usd"}, 0, 0)
    assert state == "unknown"
