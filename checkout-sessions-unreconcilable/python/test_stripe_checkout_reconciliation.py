from stripe_checkout_reconciliation import verdict


def test_client_reference_id_is_enough_on_its_own():
    state, detail = verdict({"client_reference_id": "ord_918", "payment_status": "paid"})
    assert state == "linked"
    assert "ord_918" in detail


def test_metadata_full_of_someone_elses_keys_is_not_linked():
    # A truthiness check on metadata would call this linked and report nothing.
    state, _ = verdict({"metadata": {"utm_source": "newsletter"},
                        "payment_status": "paid"})
    assert state == "orphaned"


def test_paid_and_unidentified_is_worse_than_abandoned():
    assert verdict({"payment_status": "paid"})[0] == "orphaned"
    assert verdict({"payment_status": "unpaid"})[0] == "unlinked"


def test_some_expected_keys_but_not_all_is_partial():
    state, detail = verdict({"metadata": {"order_id": "42"}, "payment_status": "paid"},
                            ("order_id", "user_id"))
    assert state == "partial"
    assert "user_id" in detail


def test_empty_and_whitespace_references_do_not_count_as_set():
    assert verdict({"client_reference_id": "", "payment_status": "paid"})[0] == "orphaned"
    assert verdict({"client_reference_id": "   ", "payment_status": "paid"})[0] == "orphaned"
    assert verdict({"metadata": {"order_id": " "}, "payment_status": "paid"})[0] == "orphaned"
