from stripe_sub_payment_method import verdict


def test_subscription_level_payment_method_wins():
    state, detail = verdict({"default_payment_method": "pm_1", "customer": {}})
    assert state == "subscription"
    assert "subscription.default_payment_method" in detail


def test_legacy_subscription_source_is_still_chargeable():
    state, detail = verdict({"default_source": "card_1", "customer": {}})
    assert state == "subscription"
    assert "legacy" in detail


def test_customer_invoice_settings_are_the_third_slot():
    sub = {"customer": {"invoice_settings": {"default_payment_method": "pm_2"}}}
    state, detail = verdict(sub)
    assert state == "customer"
    assert "invoice_settings" in detail


def test_customer_default_source_is_the_fourth_slot():
    state, _ = verdict({"customer": {"default_source": "card_2"}})
    assert state == "customer"


def test_all_four_null_is_unchargeable_and_says_no_retry():
    sub = {"customer": {"invoice_settings": {"default_payment_method": None},
                        "default_source": None}}
    state, detail = verdict(sub)
    assert state == "unchargeable"
    assert "no retry" in detail


def test_unexpanded_customer_is_not_reported_as_unchargeable():
    # A bare id string looks identical to an absent default. Saying "unchargeable"
    # here would point someone at every healthy subscription in the account.
    state, detail = verdict({"customer": "cus_123"})
    assert state == "unknown"
    assert "expand" in detail
