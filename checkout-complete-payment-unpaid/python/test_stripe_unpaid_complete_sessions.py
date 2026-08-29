from stripe_unpaid_complete_sessions import verdict


def test_a_paid_session_is_safe_to_fulfil():
    assert verdict("complete", "paid")[0] == "paid"


def test_an_open_session_is_not_this_checks_business():
    assert verdict("open", "unpaid")[0] == "skipped"


def test_unpaid_while_the_intent_processes_is_money_in_flight():
    state, detail = verdict("complete", "unpaid", "processing", ["us_bank_account"])
    assert state == "processing"
    assert "us_bank_account" in detail


def test_a_dead_intent_means_fulfilment_has_to_be_unwound():
    # Same status, same payment_status as the test above. Only the intent differs,
    # and it is the difference between waiting and having lost the goods.
    state, detail = verdict("complete", "unpaid", "requires_payment_method")
    assert state == "failed"
    assert "unwound" in detail


def test_no_payment_required_is_not_unpaid():
    assert verdict("complete", "no_payment_required")[0] == "free"
