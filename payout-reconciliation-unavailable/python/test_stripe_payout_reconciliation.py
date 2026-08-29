from stripe_payout_reconciliation import classify


def test_manual_payout_can_never_be_listed_against():
    state, detail = classify(
        {"id": "po_1", "amount": 500000, "automatic": False,
         "reconciliation_status": "not_applicable"}, None, None)
    assert state == "manual"
    assert "itemized report" in detail


def test_not_applicable_on_an_automatic_payout_is_different():
    # Same field value, different cause: nothing about the schedule will change
    # this one, because Stripe only itemises standard automatic payouts.
    state, _ = classify(
        {"id": "po_2", "amount": 500000, "automatic": True,
         "reconciliation_status": "not_applicable"}, None, None)
    assert state == "unsupported"


def test_completed_payout_whose_transactions_do_not_add_up():
    state, detail = classify(
        {"id": "po_3", "amount": 500000, "automatic": True,
         "reconciliation_status": "completed"}, 497500, 84)
    assert state == "mismatch"
    assert "2500 apart" in detail


def test_completed_and_balanced_is_the_healthy_case():
    state, _ = classify(
        {"id": "po_4", "amount": 500000, "automatic": True,
         "reconciliation_status": "completed"}, 500000, 84)
    assert state == "reconciled"


def test_in_progress_is_not_reported_as_broken():
    state, _ = classify(
        {"id": "po_5", "amount": 500000, "automatic": True,
         "reconciliation_status": "in_progress"}, None, None)
    assert state == "pending"
