from stripe_expired_cards import verdict


def test_the_expiry_month_itself_is_still_valid():
    # 06/2026 works until 30 June 2026. `exp_month <= now_month` would call this
    # expired and send a replace-your-card email for a card that works.
    state, detail = verdict(6, 2026, 2026, 6)
    assert state == "last-month"
    assert "end of 06/2026" in detail


def test_last_month_of_the_same_year_is_expired():
    assert verdict(5, 2026, 2026, 6)[0] == "expired"


def test_a_previous_year_is_expired_whatever_the_month():
    # December of last year is still in the past in January.
    assert verdict(12, 2025, 2026, 1)[0] == "expired"


def test_an_expired_default_is_escalated():
    state, detail = verdict(1, 2024, 2026, 6, True)
    assert state == "expired-default"
    assert "expired_card" in detail


def test_a_card_with_no_expiry_fields_is_not_silently_valid():
    assert verdict(None, None, 2026, 6)[0] == "unreadable"
