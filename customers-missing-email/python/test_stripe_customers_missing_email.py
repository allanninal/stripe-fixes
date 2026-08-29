from stripe_customers_missing_email import verdict


def test_a_full_customer_list_is_clear():
    assert verdict(0, 500, 0, 0, 0)[0] == "clear"


def test_a_dispute_outranks_everything_else():
    # One dispute, one missing email out of thousands. Still the top finding,
    # because that money is already gone.
    state, detail = verdict(1, 5000, 0, 0, 1)
    assert state == "disputed"
    assert "receipt" in detail


def test_an_active_subscriber_outranks_a_percentage():
    state, detail = verdict(400, 500, 1, 0, 0)
    assert state == "unreachable"
    assert "dunning" in detail


def test_a_quarter_missing_is_the_signup_path():
    state, detail = verdict(25, 100, 0, 0, 0)
    assert state == "widespread"
    assert "25%" in detail


def test_below_the_ratio_is_a_gap_not_a_path():
    assert verdict(24, 100, 0, 0, 0)[0] == "gaps"


def test_guest_receipts_are_reported_on_a_clean_customer_list():
    state, detail = verdict(0, 500, 0, 12, 0)
    assert state == "receiptless"
    assert "receipt_email" in detail
