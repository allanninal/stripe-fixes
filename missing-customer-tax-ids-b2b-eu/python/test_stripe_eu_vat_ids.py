from stripe_eu_vat_ids import verdict


def test_outside_the_eu_is_not_a_reverse_charge_question():
    state, _ = verdict("US", [], "none", 800, None)
    assert state == "out-of-scope"
    assert verdict("", [], "none", 800, None)[0] == "out-of-scope"


def test_an_eu_business_with_no_id_and_vat_charged_is_the_finding():
    state, detail = verdict("DE", [], "none", 1900, None)
    assert state == "charged-vat"
    assert "1900" in detail


def test_no_id_and_no_vat_is_a_registration_question():
    # Same empty tax ID list, no money lost by the customer, different owner.
    state, detail = verdict("FR", [], "none", 0, None)
    assert state == "no-id-no-vat"
    assert "registration" in detail


def test_reverse_charge_is_checked_before_the_id_list():
    # customer_tax_exempt can carry the treatment even where the invoice's
    # frozen tax ID array reads empty.
    assert verdict("NL", [], "reverse", 0, None)[0] == "reverse-charge"
    assert verdict("NL", [], "exempt", 0, None)[0] == "exempt"


def test_an_unconfirmed_id_is_not_coverage():
    for status in ("unverified", "unavailable", "pending"):
        state, detail = verdict("IT", [{"type": "eu_vat"}], "none", 0, status)
        assert state == "unverified"
        assert status in detail


def test_a_verified_id_is_the_only_clean_result():
    assert verdict("ES", [{"type": "eu_vat"}], "none", 0, "verified")[0] == "ok"
