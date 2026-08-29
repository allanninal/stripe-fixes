from stripe_trial_no_card import verdict

NOW = 1_800_000_000
HOUR = 3600


def trial(hours_out, behaviour=None, customer=None):
    sub = {"trial_end": NOW + hours_out * HOUR,
           "customer": {} if customer is None else customer}
    if behaviour:
        sub["trial_settings"] = {"end_behavior": {"missing_payment_method": behaviour}}
    return sub


def test_a_card_on_the_subscription_is_not_a_finding():
    sub = {"default_payment_method": "pm_1", "customer": {}}
    assert verdict(sub, NOW)[0] == "carded"


def test_a_card_on_the_customer_counts_too():
    sub = trial(24, customer={"invoice_settings": {"default_payment_method": "pm_2"}})
    assert verdict(sub, NOW)[0] == "carded"


def test_missing_trial_settings_is_read_as_the_stripe_default():
    # create_invoice is what you get by not setting the field, and it is the case
    # that produces past_due, so it must not be reported as unknown.
    state, detail = verdict(trial(12), NOW)
    assert state == "imminent"
    assert "past_due" in detail


def test_pause_is_named_as_a_different_outcome():
    state, detail = verdict(trial(12, "pause"), NOW)
    assert state == "imminent"
    assert "paused" in detail


def test_a_trial_ending_in_three_weeks_is_not_imminent():
    state, detail = verdict(trial(24 * 21), NOW)
    assert state == "no-card"
    assert "day(s)" in detail


def test_unexpanded_customer_is_not_silently_carded():
    state, detail = verdict({"trial_end": NOW + HOUR, "customer": "cus_9"}, NOW)
    assert state == "unknown"
    assert "expand" in detail
