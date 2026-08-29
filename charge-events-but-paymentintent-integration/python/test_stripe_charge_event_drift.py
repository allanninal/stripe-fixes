from stripe_charge_event_drift import verdict


def test_charge_only_while_intents_fire_is_stale():
    state, detail = verdict(["charge.succeeded"], ["payment_intent.succeeded"])
    assert state == "stale"
    assert "client_reference_id" in detail


def test_the_same_config_with_no_modern_traffic_is_a_real_charges_integration():
    # Identical enabled_events. Only the account's traffic tells them apart.
    state, _ = verdict(["charge.succeeded"], [])
    assert state == "legacy"


def test_subscribing_to_both_is_double_fulfilment():
    state, detail = verdict(["charge.succeeded", "payment_intent.succeeded"],
                            ["payment_intent.succeeded"])
    assert state == "overlapping"
    assert "twice" in detail


def test_checkout_sessions_firing_with_no_session_subscription():
    state, _ = verdict(["payment_intent.succeeded"],
                       ["payment_intent.succeeded", "checkout.session.completed"])
    assert state == "checkout-gap"


def test_a_matching_subscription_is_aligned():
    state, _ = verdict(["payment_intent.succeeded", "checkout.session.completed"],
                       ["payment_intent.succeeded", "checkout.session.completed"])
    assert state == "aligned"


def test_a_wildcard_is_called_out_rather_than_passed():
    state, _ = verdict(["*"], ["payment_intent.succeeded"])
    assert state == "wildcard"
