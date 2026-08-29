from stripe_settlement_currency import verdict

US_SPEC = {
    "supported_transfer_countries": ["US", "GB", "DE"],
    "supported_bank_account_currencies": {"usd": ["US"], "gbp": ["GB"], "eur": ["DE"]},
}
US = {"country": "US", "default_currency": "usd"}


def test_a_matching_default_destination_settles():
    externals = [{"currency": "usd", "default_for_currency": True}]
    assert verdict(US, externals, US_SPEC)[0] == "settles"


def test_a_matching_destination_that_is_not_the_default_is_its_own_finding():
    # One flag away from working, and nothing to collect from the seller.
    state, detail = verdict(US, [{"currency": "usd", "default_for_currency": False}],
                            US_SPEC)
    assert state == "not-default"
    assert "default_for_currency" in detail


def test_a_wrong_currency_destination_names_what_is_actually_attached():
    state, detail = verdict(US, [{"currency": "aud", "default_for_currency": True}],
                            US_SPEC)
    assert state == "currency-missing"
    assert "AUD" in detail
    assert "USD" in detail


def test_no_destination_at_all_is_separate_from_a_wrong_one():
    assert verdict(US, [], US_SPEC)[0] == "no-destination"


def test_an_unsupported_corridor_outranks_the_currency_check():
    # Both are true for this account. Reporting the currency sends someone to
    # collect bank details that cannot be made to work.
    acct = {"country": "BR", "default_currency": "brl"}
    state, detail = verdict(acct, [{"currency": "aud"}], US_SPEC)
    assert state == "unsupported-corridor"
    assert "BR" in detail


def test_a_country_that_cannot_hold_the_currency_is_reported_as_such():
    acct = {"country": "GB", "default_currency": "usd"}
    assert verdict(acct, [{"currency": "gbp"}], US_SPEC)[0] == "unbankable-currency"


def test_the_corridor_checks_are_skipped_without_a_spec():
    acct = {"country": "BR", "default_currency": "brl"}
    externals = [{"currency": "brl", "default_for_currency": True}]
    assert verdict(acct, externals, None)[0] == "settles"


def test_a_missing_default_currency_is_not_silently_settling():
    assert verdict({"country": "US"}, [{"currency": "usd"}], None)[0] == "unknown"
