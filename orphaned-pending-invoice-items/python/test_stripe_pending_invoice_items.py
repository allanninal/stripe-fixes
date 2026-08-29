from stripe_pending_invoice_items import bucket_by_customer, verdict


def test_a_live_subscription_means_the_item_is_merely_waiting():
    state, detail = verdict(6.0, True, 2)
    assert state == "waiting"
    assert "2 pending item(s)" in detail


def test_no_subscription_is_orphaned_at_any_age():
    # This is the whole point: age is irrelevant once nothing will ever bill.
    assert verdict(3.0, False, 1)[0] == "orphaned"
    assert verdict(400.0, False, 1)[0] == "orphaned"


def test_an_item_created_today_gets_the_benefit_of_the_doubt():
    assert verdict(0.5, False, 1)[0] == "fresh"
    assert verdict(1.0, False, 1)[0] == "orphaned"


def test_the_cycle_boundaries_separate_aging_from_stalled():
    assert verdict(34.9, True, 1)[0] == "waiting"
    assert verdict(35.0, True, 1)[0] == "aging"
    assert verdict(59.9, True, 1)[0] == "aging"
    assert verdict(60.0, True, 1)[0] == "stalled"


def test_bucketing_keeps_currencies_apart_and_the_oldest_date():
    items = [
        {"customer": "cus_1", "date": 500, "amount": 1000, "currency": "eur"},
        {"customer": "cus_1", "date": 100, "amount": 250, "currency": "eur"},
        {"customer": "cus_1", "date": 900, "amount": 700, "currency": "usd"},
        {"customer": None, "date": 100, "amount": 999, "currency": "eur"},
    ]
    b = bucket_by_customer(items)["cus_1"]
    assert b["count"] == 3
    assert b["oldest"] == 100
    assert b["amounts"] == {"EUR": 1250, "USD": 700}
