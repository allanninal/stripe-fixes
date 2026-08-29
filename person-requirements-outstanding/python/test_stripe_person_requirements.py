from stripe_person_requirements import blocked_on, person_ref, verdict


def test_person_reference_yields_the_id_before_the_first_dot():
    assert person_ref("person_1MqEZ2eZvKYlo2C.verification.document") == "person_1MqEZ2eZvKYlo2C"


def test_ordinary_account_fields_are_not_person_references():
    assert person_ref("business_profile.url") is None
    assert person_ref("external_account") is None
    assert person_ref(None) is None


def test_past_due_outranks_currently_due():
    # past_due is a subset of currently_due, so the order of these checks is the
    # difference between "already broken" and "some paperwork outstanding".
    state, detail = verdict({"requirements": {"past_due": ["dob.day"],
                                              "currently_due": ["dob.day", "id_number"]}})
    assert state == "past-due"
    assert "dob.day" in detail


def test_currently_due_names_the_fields():
    state, detail = verdict({"requirements": {"currently_due": ["id_number"]}})
    assert state == "blocking"
    assert "id_number" in detail


def test_pending_verification_is_not_something_to_collect():
    state, _ = verdict({"requirements": {}, "verification": {"status": "pending"}})
    assert state == "verifying"


def test_missing_verification_status_is_not_silently_clear():
    assert verdict({})[0] == "unknown"


def test_account_requirements_resolve_to_a_deduplicated_person_list():
    acct = {"requirements": {
        "past_due": ["person_1A.verification.document"],
        "currently_due": ["person_1A.verification.document", "person_1B.dob.day",
                          "business_profile.url"]}}
    assert blocked_on(acct) == ["person_1A", "person_1B"]
