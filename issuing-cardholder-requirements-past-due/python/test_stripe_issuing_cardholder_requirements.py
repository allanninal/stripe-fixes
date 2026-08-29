from stripe_issuing_cardholder_requirements import explain_decline, verdict

TERMS = ["individual.card_issuing.user_terms_acceptance.ip",
         "individual.card_issuing.user_terms_acceptance.date"]


def cardholder(past_due=(), reason=None, status="active"):
    return {"id": "ich_1", "status": status,
            "requirements": {"past_due": list(past_due), "disabled_reason": reason}}


def test_a_clean_active_cardholder_with_no_inactive_cards_is_healthy():
    assert verdict(cardholder(), 0)[0] == "healthy"


def test_terms_only_is_not_a_verification_problem():
    state, detail = verdict(cardholder(TERMS), 3)
    assert state == "blocked-terms"
    assert "Nothing needs verifying" in detail
    assert "3 inactive card(s)" in detail


def test_one_identity_field_alongside_terms_is_an_identity_block():
    # The distinction is all-or-nothing on purpose: a passport scan in the list
    # means somebody has to send documents, whatever else is in there with it.
    state, _ = verdict(cardholder(TERMS + ["individual.dob.day"]), 1)
    assert state == "blocked-identity"


def test_identity_fields_are_named_in_the_detail():
    state, detail = verdict(
        cardholder(["individual.first_name", "individual.last_name"]), 0)
    assert state == "blocked-identity"
    assert "individual.first_name" in detail


def test_a_clean_cardholder_with_inactive_cards_is_a_gap_in_your_own_flow():
    state, detail = verdict(cardholder(), 4)
    assert state == "dormant"
    assert "nobody ever called it" in detail


def test_a_disabled_reason_without_past_due_is_reported_separately():
    state, _ = verdict(cardholder(reason="listed"), 2)
    assert state == "disabled"


def test_an_inactive_cardholder_with_nothing_outstanding_says_so():
    state, detail = verdict(cardholder(status="inactive"), 1)
    assert state == "inactive-cardholder"
    assert "deliberately" in detail


def test_every_known_decline_reason_gets_its_own_repair():
    hints = {r: explain_decline(r) for r in
             ("card_inactive", "cardholder_inactive", "verification_failed",
              "insufficient_funds", "spending_controls", "webhook_timeout")}
    assert len(set(hints.values())) == 6
    assert "top it up" in hints["insufficient_funds"]
    assert "latency" in hints["webhook_timeout"]


def test_an_unknown_decline_reason_is_named_not_swallowed():
    assert "some_new_reason" in explain_decline("some_new_reason")
