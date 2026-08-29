from stripe_automatic_tax_off import verdict


def test_all_enabled_is_clear():
    state, detail = verdict(0, 412, [])
    assert state == "on"
    assert "412" in detail


def test_off_everywhere_with_eu_invoices_is_the_loud_case():
    state, detail = verdict(300, 300, ["DE", "FR", "de"])
    assert state == "exposed"
    assert "DE, FR" in detail


def test_a_fixed_create_path_with_no_backfill_reads_as_partial():
    # The dangerous version: new invoices look right in the Dashboard while the
    # older subscriptions keep billing untaxed.
    state, detail = verdict(40, 300, ["GB"])
    assert state == "partial"
    assert "never backfilled" in detail


def test_one_domestic_country_is_a_question_not_a_verdict():
    state, detail = verdict(50, 50, ["US"])
    assert state == "domestic"
    assert "registrations" in detail


def test_no_country_anywhere_cannot_be_judged():
    state, detail = verdict(50, 50, [None, ""])
    assert state == "unknown"
    assert "cannot be judged" in detail
