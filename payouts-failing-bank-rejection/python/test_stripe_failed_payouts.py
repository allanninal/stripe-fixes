from stripe_failed_payouts import classify


def test_paid_is_not_treated_as_final():
    # The paid to failed transition happens up to five business days later. A
    # classifier that calls paid "done" is the bug this guide is about.
    state, detail = classify({"status": "paid"})
    assert state == "open"
    assert "not final" in detail


def test_closed_account_needs_new_details():
    state, detail = classify({
        "status": "failed", "failure_code": "account_closed",
        "failure_balance_transaction": "txn_1",
    })
    assert state == "new-details"
    assert "fails identically" in detail


def test_debit_not_authorized_is_not_a_bank_details_problem():
    # The number is right. Attaching a new external account changes nothing, and
    # asking the seller for it wastes a round trip while they stay unpaid.
    state, detail = classify({
        "status": "failed", "failure_code": "debit_not_authorized",
        "failure_balance_transaction": "txn_2",
    })
    assert state == "bank-authorisation"
    assert "New details will not help" in detail


def test_insufficient_funds_is_your_side():
    state, detail = classify({
        "status": "failed", "failure_code": "insufficient_funds",
        "failure_balance_transaction": "txn_3",
    })
    assert state == "funding"
    assert "your side" in detail


def test_missing_reversal_is_called_out():
    _, detail = classify({"status": "failed", "failure_code": "account_closed"})
    assert "no failure_balance_transaction" in detail


def test_unknown_code_is_reported_rather_than_swallowed():
    state, detail = classify({
        "status": "failed", "failure_code": "brand_new_code",
        "failure_message": "Something Stripe added later",
    })
    assert state == "unclassified"
    assert "brand_new_code" in detail
    assert classify({"status": "in_flight"})[0] == "unknown"
