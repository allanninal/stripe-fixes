import datetime as dt

from stripe_card_expiry_window import expires_at, verdict


def utc(year, month):
    return int(dt.datetime(year, month, 1, tzinfo=dt.timezone.utc).timestamp())


def test_a_card_is_valid_through_the_end_of_its_month():
    # 04/2029 dies at the first instant of May, not of April.
    assert expires_at(4, 2029) == utc(2029, 5)


def test_december_rolls_into_the_next_year():
    assert expires_at(12, 2026) == utc(2027, 1)


def test_february_of_a_leap_year_still_lands_on_march():
    assert expires_at(2, 2028) == utc(2028, 3)


def test_an_expiry_already_past_is_a_decline_that_happened():
    state, detail = verdict(-3.0, is_default=True)
    assert state == "expired"
    assert "billing default" in detail


def test_the_window_edge_is_inclusive():
    assert verdict(60.0)[0] == "warn"
    assert verdict(60.1)[0] == "ok"


def test_the_default_card_is_its_own_bucket():
    assert verdict(20.0)[0] == "warn"
    assert verdict(20.0, is_default=True)[0] == "urgent"


def test_wallet_credentials_are_not_warned_about():
    state, detail = verdict(10.0, is_default=True, wallet="apple_pay")
    assert state == "tokenised"
    assert "reissued" in detail


def test_a_card_with_no_expiry_is_not_silently_fine():
    assert verdict(None)[0] == "unreadable"
