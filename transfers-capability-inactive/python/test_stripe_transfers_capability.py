from stripe_transfers_capability import classify


def test_absent_capability_is_unrequested_not_inactive():
    # No transfers key on the account at all. Nothing is outstanding, so no
    # onboarding link will ever help; the capability has to be requested.
    state, detail = classify(None)
    assert state == "unrequested"
    assert "never requested" in detail


def test_active_is_the_only_healthy_status():
    assert classify({"status": "active"})[0] == "active"


def test_pending_is_not_something_to_chase():
    state, detail = classify({
        "status": "pending",
        "requirements": {"pending_verification": ["individual.verification.document"]},
    })
    assert state == "verifying"
    assert "does not speed it up" in detail


def test_inactive_with_fields_names_them():
    state, detail = classify({
        "status": "inactive",
        "requirements": {"currently_due": ["company.tax_id", "business_profile.url"]},
    })
    assert state == "blocked"
    assert "company.tax_id" in detail


def test_rejected_reason_is_not_a_field_to_collect():
    state, detail = classify({
        "status": "inactive",
        "requirements": {"currently_due": [], "disabled_reason": "rejected.fraud"},
    })
    assert state == "held"
    assert "rejected.fraud" in detail
