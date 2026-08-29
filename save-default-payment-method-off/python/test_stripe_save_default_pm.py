from stripe_save_default_pm import verdict


def sub(**over):
    base = {"id": "sub_1", "status": "active", "payment_settings": {},
            "default_payment_method": None,
            "customer": {"id": "cus_1", "invoice_settings": {}}}
    base.update(over)
    return base


def test_an_absent_flag_is_treated_as_off():
    # Stripe omits the field when it was never set. This is the common shape.
    state, _ = verdict(sub(payment_settings={}))
    assert state == "stranded"


def test_an_explicit_off_reaches_the_same_verdict():
    assert verdict(sub(payment_settings={"save_default_payment_method": "off"}))[0] \
        == "stranded"


def test_on_subscription_is_the_fix():
    state, _ = verdict(sub(payment_settings={"save_default_payment_method": "on_subscription"}))
    assert state == "on"


def test_a_subscription_default_makes_the_flag_moot():
    assert verdict(sub(default_payment_method="pm_1"))[0] == "saved"


def test_a_customer_default_is_a_fallback_not_a_fix():
    state, detail = verdict(sub(customer={"id": "cus_1",
                                          "invoice_settings": {"default_payment_method": "pm_2"}}))
    assert state == "fallback"
    assert "refactor" in detail


def test_past_due_with_nothing_to_charge_has_already_failed():
    state, _ = verdict(sub(status="past_due"))
    assert state == "failing"


def test_an_unexpanded_customer_is_not_silently_stranded():
    # A bare id looks exactly like a customer with no default. Say so instead.
    state, detail = verdict(sub(customer="cus_1"))
    assert state == "unknown"
    assert "expand" in detail


def test_an_unrecognised_value_is_not_silently_healthy():
    assert verdict(sub(payment_settings={"save_default_payment_method": "always"}))[0] \
        == "unknown"
