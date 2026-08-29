from stripe_tax_blocked_drafts import verdict


def test_the_finalization_error_is_the_headline():
    state, detail = verdict("customer_tax_location_invalid",
                            "requires_location_inputs", None, True)
    assert state == "tax-location"
    assert "cannot resolve" in detail


def test_tax_dropped_is_reported_even_though_the_invoice_will_finalize():
    # No error and no stuck draft: Stripe disabled tax so the bill could go out.
    # It is the expensive case and the one nothing else surfaces.
    state, detail = verdict(None, "requires_location_inputs",
                            "finalization_requires_location_inputs", True)
    assert state == "tax-dropped"
    assert "no tax on it" in detail


def test_requires_location_inputs_alone_is_a_warning_not_an_error():
    state, _ = verdict(None, "requires_location_inputs", None, True)
    assert state == "needs-address"


def test_a_stripe_side_failure_is_not_the_customers_address():
    state, detail = verdict(None, "failed", None, True)
    assert state == "tax-failed"
    assert "retry the finalization" in detail


def test_a_non_tax_finalization_error_is_kept_separate():
    state, detail = verdict("invoice_payment_intent_requires_action", None, None, True)
    assert state == "other-error"
    assert "not tax" in detail


def test_auto_advance_is_read_last():
    # Both true at once: the tax problem is the one a human can act on, so a
    # stranded draft with a tax error must not be filed as merely stranded.
    assert verdict("customer_tax_location_invalid", None, None, False)[0] == "tax-location"
    assert verdict(None, None, None, False)[0] == "not-advancing"


def test_a_healthy_draft_is_clear():
    assert verdict(None, "complete", None, True)[0] == "clear"
