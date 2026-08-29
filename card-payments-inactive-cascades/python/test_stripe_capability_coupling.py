from stripe_capability_coupling import union_due, verdict


def test_both_active_is_healthy():
    assert verdict({"card_payments": "active", "transfers": "active"})[0] == "healthy"


def test_an_active_transfers_is_still_down_when_card_payments_is_inactive():
    # The whole point of the note: reading only the capability you use says fine.
    state, detail = verdict({"card_payments": "inactive", "transfers": "active"})
    assert state == "coupled-down"
    assert "card_payments" in detail
    assert "transfers" in detail


def test_the_coupling_runs_the_other_way_too():
    state, detail = verdict({"card_payments": "active", "transfers": "inactive"})
    assert state == "coupled-down"
    assert "transfers is inactive" in detail


def test_one_capability_alone_is_not_a_coupling_problem():
    assert verdict({"transfers": "inactive"})[0] == "uncoupled"
    assert verdict({})[0] == "uncoupled"


def test_pending_is_separated_from_inactive():
    state, _ = verdict({"card_payments": "pending", "transfers": "active"})
    assert state == "coupled-pending"


def test_an_unrecognised_status_is_not_silently_healthy():
    assert verdict({"card_payments": "revoked", "transfers": "active"})[0] == "unknown"


def test_the_union_keeps_fields_owed_by_a_capability_you_do_not_use():
    caps = [
        {"id": "transfers", "requirements": {"currently_due": []}},
        {"id": "card_payments",
         "requirements": {"currently_due": ["business_profile.mcc"],
                          "past_due": ["business_profile.url"]}},
    ]
    assert union_due(caps) == [
        ("business_profile.mcc", ["card_payments"]),
        ("business_profile.url", ["card_payments"]),
    ]


def test_a_field_owed_by_both_names_both():
    caps = [
        {"id": "transfers", "requirements": {"currently_due": ["tos_acceptance.date"]}},
        {"id": "card_payments", "requirements": {"currently_due": ["tos_acceptance.date"]}},
    ]
    assert union_due(caps) == [("tos_acceptance.date", ["card_payments", "transfers"])]
