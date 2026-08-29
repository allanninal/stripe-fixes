from stripe_verification_errors import classify


def test_no_errors_is_clear():
    assert classify([])[0] == "clear"
    assert classify(None)[0] == "clear"


def test_greyscale_asks_for_colour_not_for_patience():
    state, detail = classify([{
        "code": "verification_document_failed_greyscale",
        "reason": "The document could not be verified because it is greyscale.",
        "requirement": "individual.verification.document",
    }])
    assert state == "document"
    assert "colour" in detail


def test_keyed_identity_is_a_field_edit_not_a_new_file():
    state, detail = classify([{"code": "verification_failed_keyed_identity",
                               "requirement": "individual.first_name"}])
    assert state == "identity"
    assert "not the file" in detail


def test_a_field_code_names_its_requirement():
    state, detail = classify([{"code": "invalid_tax_id_format",
                               "requirement": "company.tax_id"}])
    assert state == "field"
    assert "company.tax_id" in detail


def test_the_website_family_is_matched_by_prefix():
    # Stripe keeps adding to invalid_url_website_*, so this must not be a list.
    state, detail = classify([{"code": "invalid_url_website_incomplete_cancellation_policy",
                               "requirement": "business_profile.url"}])
    assert state == "website"
    assert "force re-verification" in detail


def test_an_unknown_code_is_unmapped_and_keeps_its_reason():
    state, detail = classify([{"code": "verification_something_brand_new",
                               "reason": "A reason only Stripe knows yet.",
                               "requirement": "individual.id_number"}])
    assert state == "unmapped"
    assert "A reason only Stripe knows yet." in detail


def test_a_blocking_document_error_wins_over_a_website_one():
    state, _ = classify([
        {"code": "invalid_url_website_other", "requirement": "business_profile.url"},
        {"code": "verification_document_expired",
         "requirement": "individual.verification.document"},
    ])
    assert state == "document"
