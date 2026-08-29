from stripe_onboarding_stalled import classify


def acct(submitted=False, due=("individual.dob.day", "individual.address.line1",
                               "business_profile.url", "external_account")):
    return {"details_submitted": submitted,
            "requirements": {"currently_due": list(due)}}


def test_a_submitted_account_is_finished():
    assert classify(acct(submitted=True), 400.0)[0] == "submitted"


def test_a_fresh_signup_is_not_chased():
    state, detail = classify(acct(), 1.5)
    assert state == "in-flight"
    assert "do not chase it yet" in detail


def test_seven_days_is_the_boundary():
    assert classify(acct(), 6.9)[0] == "in-flight"
    assert classify(acct(), 7.0)[0] == "abandoned-cold"


def test_a_short_remaining_list_means_they_nearly_finished():
    state, detail = classify(acct(due=("external_account",)), 40.0)
    assert state == "abandoned-late"
    assert "external_account" in detail


def test_unsubmitted_with_nothing_due_is_a_different_bug():
    # No capability requested, so Stripe is not asking for anything and no
    # onboarding link will collect anything either.
    state, detail = classify(acct(due=()), 40.0)
    assert state == "unknown"
    assert "no capability has been requested" in detail
