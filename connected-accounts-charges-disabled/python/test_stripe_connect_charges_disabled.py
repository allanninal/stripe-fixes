from stripe_connect_charges_disabled import classify


def test_enabled_account_is_live():
    state, _ = classify({"charges_enabled": True, "details_submitted": True})
    assert state == "live"


def test_never_onboarded_is_not_an_incident():
    state, detail = classify({"charges_enabled": False, "details_submitted": False})
    assert state == "never-onboarded"
    assert "never opened" in detail


def test_every_rejected_reason_is_dashboard_only():
    # rejected.* is an open family; matching the prefix rather than a fixed list
    # is the difference between a correct answer and one that ages badly.
    for reason in ("rejected.fraud", "rejected.listed", "rejected.terms_of_service",
                   "rejected.other", "listed", "under_review"):
        state, detail = classify({
            "charges_enabled": False, "details_submitted": True,
            "requirements": {"disabled_reason": reason,
                             "currently_due": ["company.tax_id"]},
        })
        assert state == "rejected", reason
        assert "cannot clear" in detail


def test_past_due_is_blocked_and_names_the_fields():
    state, detail = classify({
        "charges_enabled": False, "details_submitted": True,
        "requirements": {"disabled_reason": "requirements.past_due",
                         "currently_due": ["company.tax_id", "business_profile.url"]},
    })
    assert state == "blocked"
    assert "company.tax_id" in detail


def test_pending_verification_asks_nobody_for_anything():
    state, detail = classify({
        "charges_enabled": False, "details_submitted": True,
        "requirements": {"disabled_reason": "requirements.pending_verification",
                         "currently_due": []},
    })
    assert state == "waiting"
    assert "does not speed it up" in detail


def test_disabled_with_no_explanation_is_not_reported_as_healthy():
    state, _ = classify({"charges_enabled": False, "details_submitted": True,
                         "requirements": {}})
    assert state == "unknown"
