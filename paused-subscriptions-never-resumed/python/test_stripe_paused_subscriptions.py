from stripe_paused_subscriptions import verdict

NOW = 1_800_000_000
DAY = 86400


def paused(days_ago, interval="month", count=1, **extra):
    body = {
        "id": "sub_1",
        "status": "paused",
        "trial_end": NOW - days_ago * DAY,
        "items": {"data": [{"price": {"recurring": {"interval": interval,
                                                    "interval_count": count}}}]},
    }
    body.update(extra)
    return body


def test_a_card_on_file_beats_age():
    state, _ = verdict(paused(400, default_payment_method="pm_1"), NOW)
    assert state == "resumable"


def test_a_customer_default_counts_as_a_card():
    customer = {"invoice_settings": {"default_payment_method": "pm_2"}}
    state, _ = verdict(paused(400, customer=customer), NOW)
    assert state == "resumable"


def test_past_one_billing_interval_is_dead_inventory():
    state, detail = verdict(paused(90), NOW)
    assert state == "stale"
    assert "90 day(s)" in detail


def test_the_interval_comes_from_this_subscriptions_own_price():
    # Two months is stale on a monthly plan and recent on a yearly one.
    assert verdict(paused(60, interval="year"), NOW)[0] == "recent"
    assert verdict(paused(60, interval="month"), NOW)[0] == "stale"


def test_only_paused_is_this_problem():
    state, _ = verdict(paused(90, status="active"), NOW)
    assert state == "not-paused"
