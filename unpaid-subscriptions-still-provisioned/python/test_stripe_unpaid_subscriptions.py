from stripe_unpaid_subscriptions import verdict

UNPAID = {"id": "sub_1", "status": "unpaid"}


def test_unpaid_with_closed_drafts_reports_the_balance_owed():
    state, detail = verdict(UNPAID, [{"auto_advance": False, "amount_due": 2500},
                                     {"auto_advance": False, "amount_due": 2500}])
    assert state == "stranded"
    assert "5000" in detail


def test_missing_auto_advance_counts_as_closed():
    # Absent is not true. A draft Stripe closed on creation carries no flag at
    # all, and reading that as collecting hides the whole finding.
    state, _ = verdict(UNPAID, [{"amount_due": 900}])
    assert state == "stranded"


def test_drafts_with_auto_advance_mean_somebody_restarted_collection():
    state, _ = verdict(UNPAID, [{"auto_advance": True, "amount_due": 900}])
    assert state == "collecting"


def test_unpaid_with_no_invoices_is_its_own_finding():
    # Nothing to chase, but the access is still granted.
    state, detail = verdict(UNPAID, [])
    assert state == "silent"
    assert "past_due" in detail


def test_a_past_due_subscription_is_not_this_problem():
    state, _ = verdict({"id": "sub_2", "status": "past_due"}, [])
    assert state == "not-unpaid"
