from stripe_elevated_risk_review import verdict


def charge(risk="elevated", outcome_type="authorized", review=None,
           captured=True, disputed=False):
    return {
        "id": "ch_1",
        "amount": 12900,
        "currency": "usd",
        "captured": captured,
        "disputed": disputed,
        "review": review,
        "outcome": {"risk_level": risk, "type": outcome_type},
    }


def test_elevated_captured_with_no_review_is_the_finding():
    state, detail = verdict(charge())
    assert state == "straight-through"
    assert "no human" in detail


def test_elevated_that_reached_review_is_not_flagged():
    assert verdict(charge(review="prv_1"))[0] == "reviewed"


def test_elevated_still_on_a_hold_is_its_own_state():
    # Different instruction to a human: this one can still be released.
    state, detail = verdict(charge(captured=False))
    assert state == "uncaptured"
    assert "released" in detail


def test_elevated_already_disputed_is_separated_from_the_rest():
    assert verdict(charge(disputed=True))[0] == "disputed"


def test_not_assessed_is_not_reported_as_clean():
    state, detail = verdict(charge(risk="not_assessed"))
    assert state == "not_assessed"
    assert "never scored" in detail
