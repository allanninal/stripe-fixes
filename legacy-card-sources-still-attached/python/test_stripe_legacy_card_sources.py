from stripe_legacy_card_sources import classify

MODERN_DEFAULT = {"invoice_settings": {"default_payment_method": "pm_1"}}


def test_migrated_customer_is_modern():
    state, _ = classify(MODERN_DEFAULT, [], [{"id": "pm_1"}])
    assert state == "modern"


def test_legacy_card_with_no_payment_method_is_the_split_brain_case():
    cust = {"default_source": "card_1", "invoice_settings": {}}
    state, detail = classify(cust, [{"id": "card_1"}], [])
    assert state == "split_brain"
    assert "no card" in detail


def test_src_objects_count_as_legacy_too():
    cust = {"default_source": "src_1", "invoice_settings": {}}
    assert classify(cust, [{"id": "src_1"}], [])[0] == "split_brain"


def test_both_stores_with_no_modern_default_still_renews_on_the_old_card():
    cust = {"default_source": "card_1", "invoice_settings": {}}
    state, detail = classify(cust, [{"id": "card_1"}], [{"id": "pm_1"}])
    assert state == "split_default"
    assert "falls back" in detail


def test_both_stores_with_a_modern_default_is_only_residue():
    state, _ = classify(MODERN_DEFAULT, [{"id": "card_1"}], [{"id": "pm_1"}])
    assert state == "residue"


def test_no_card_anywhere_is_its_own_state():
    state, _ = classify({"invoice_settings": {}}, [], [])
    assert state == "cardless"
