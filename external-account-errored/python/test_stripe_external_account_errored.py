from stripe_external_account_errored import HALTED, verdict

NOW = 1767225600  # 2026-01-01T00:00:00Z


def bank(status, default=True, currency="usd"):
    return {"id": "ba_1", "status": status, "currency": currency,
            "default_for_currency": default}


def test_a_validated_account_is_healthy():
    state, detail = verdict(bank("validated"), None, None, NOW)
    assert state == "healthy"
    assert "payouts can be sent" in detail


def test_new_is_not_an_error():
    # `new` only means Stripe has had no reason to validate it yet.
    assert verdict(bank("new"), None, None, NOW)[0] == "healthy"


def test_every_halting_status_is_caught_and_carries_its_own_repair():
    for status in HALTED:
        state, detail = verdict(bank(status), None, None, NOW)
        assert state == "halted", status
        assert status in detail


def test_errored_says_not_to_edit_the_existing_object():
    _, detail = verdict(bank("errored"), None, None, NOW)
    assert "does not clear this" in detail
    assert "NEW external account" in detail


def test_a_balance_behind_a_frozen_destination_is_stranded():
    state, detail = verdict(bank("errored"), NOW - 45 * 86400, 812340, NOW)
    assert state == "stranded"
    assert "812340" in detail
    assert "45 day(s) ago" in detail


def test_evidence_that_was_never_gathered_is_not_reported_as_no_money():
    # available_amount None means nobody looked. Saying "no payout has ever been
    # attempted" in that case would be an invention.
    _, detail = verdict(bank("errored"), None, None, NOW)
    assert "no payout has ever been attempted" not in detail
    _, detail = verdict(bank("errored"), None, 0, NOW)
    assert "no payout has ever been attempted" in detail


def test_a_frozen_non_default_destination_is_flagged_as_cleanup():
    _, detail = verdict(bank("verification_failed", default=False), None, None, NOW)
    assert "not the default destination for usd" in detail


def test_no_bank_account_at_all_is_its_own_answer():
    state, _ = verdict(None, None, None, NOW)
    assert state == "no-destination"


def test_an_unrecognised_status_is_not_assumed_healthy():
    assert verdict(bank("some_new_status"), None, None, NOW)[0] == "unknown"
