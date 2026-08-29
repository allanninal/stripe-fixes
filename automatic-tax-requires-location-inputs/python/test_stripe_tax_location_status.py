from stripe_tax_location_status import verdict


def test_disabled_reason_outranks_the_status():
    # Both are set on the same invoice. The disabled reason means the bill went
    # out untaxed, which is the more expensive fact and must win.
    state, detail = verdict("requires_location_inputs",
                            "finalization_requires_location_inputs", True)
    assert state == "billed-untaxed"
    assert "no tax and no error" in detail


def test_a_system_error_disable_is_its_own_state():
    state, _ = verdict(None, "finalization_system_error", True)
    assert state == "billed-unpriced"


def test_requires_location_inputs_splits_on_finalization():
    # Still a draft: fixing the customer is the whole repair.
    assert verdict("requires_location_inputs", None, False)[0] == "blocked"
    # Already finalized: the tax on the document is immutable.
    state, detail = verdict("requires_location_inputs", None, True)
    assert state == "frozen"
    assert "no longer be changed" in detail


def test_failed_is_stripe_side_and_wants_a_retry():
    state, detail = verdict("failed", None, True)
    assert state == "failed"
    assert "retry" in detail


def test_complete_is_not_a_location_problem():
    state, detail = verdict("complete", None, True)
    assert state == "complete"
    assert "registration" in detail


def test_an_unrecognised_status_is_not_silently_complete():
    assert verdict(None, None, True)[0] == "unknown"
    assert verdict("pending", None, True)[0] == "unknown"
