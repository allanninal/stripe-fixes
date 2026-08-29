from stripe_portal_cancel_disabled import verdict

FULL = {"id": "bpc_1", "features": {
    "subscription_cancel": {"enabled": True, "mode": "at_period_end",
                            "cancellation_reason": {"enabled": True}},
    "payment_method_update": {"enabled": True}}}
NO_CANCEL = {"id": "bpc_2", "features": {
    "subscription_cancel": {"enabled": False},
    "payment_method_update": {"enabled": True}}}


def test_a_portal_that_cancels_and_asks_why_is_done():
    state, detail = verdict(FULL, 0, 40)
    assert state == "self-serve"
    assert "at_period_end" in detail


def test_cancellation_off_with_no_disputes_is_still_the_finding():
    state, detail = verdict(NO_CANCEL, 0, 0)
    assert state == "cancel-off"
    assert "their bank" in detail


def test_cancellation_off_with_disputes_naming_it_is_priced():
    state, detail = verdict(NO_CANCEL, 7, 42)
    assert state == "cancel-off-disputed"
    assert "16.7%" in detail


def test_cancel_on_but_card_update_off_still_sends_people_to_support():
    config = {"id": "bpc_3", "features": {
        "subscription_cancel": {"enabled": True, "mode": "immediately",
                                "cancellation_reason": {"enabled": True}},
        "payment_method_update": {"enabled": False}}}
    assert verdict(config)[0] == "update-off"


def test_cancelling_without_asking_why_throws_away_the_churn_data():
    config = {"id": "bpc_4", "features": {
        "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
        "payment_method_update": {"enabled": True}}}
    state, detail = verdict(config)
    assert state == "no-reason"
    assert "at_period_end" in detail


def test_a_missing_enabled_flag_is_not_read_as_off():
    # Reporting a cancel button as missing on a portal that has one sends somebody
    # to fix a configuration that is already correct.
    assert verdict({"id": "bpc_5", "features": {"subscription_cancel": {}}})[0] == "unknown"
    assert verdict(None)[0] == "unknown"
