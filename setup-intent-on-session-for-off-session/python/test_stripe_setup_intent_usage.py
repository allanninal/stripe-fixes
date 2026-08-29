from stripe_setup_intent_usage import verdict


def test_on_session_saves_for_subscribed_customers_with_declines_are_the_diagnosis():
    state, detail = verdict(500, 40, 12, 7)
    assert state == "declining"
    assert "12" in detail and "7" in detail


def test_on_session_saves_for_subscribed_customers_are_flagged_before_anything_fails():
    state, detail = verdict(500, 40, 12, 0)
    assert state == "exposed"
    assert "next renewal" in detail


def test_on_session_saves_with_no_subscribers_are_only_worth_a_look():
    # A stored card for a customer-present one-click checkout is legitimately on_session.
    state, _ = verdict(500, 40, 0, 0)
    assert state == "review"


def test_declines_without_on_session_saves_are_a_different_bug():
    state, detail = verdict(500, 0, 0, 31)
    assert state == "elsewhere"
    assert "not the cause" in detail


def test_all_off_session_and_no_declines_is_clear():
    assert verdict(500, 0, 0, 0)[0] == "clear"


def test_an_empty_window_is_not_silently_clear():
    assert verdict(0, 0, 0, 0)[0] == "unknown"
