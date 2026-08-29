from stripe_platform_paused import verdict

NOW = 1767225600  # 2026-01-01T00:00:00Z


def account(reason=None, charges=True, payouts=True):
    return {"id": "acct_1", "charges_enabled": charges, "payouts_enabled": payouts,
            "requirements": {"disabled_reason": reason}}


def test_a_normal_account_is_healthy():
    assert verdict(account(), 0, None, NOW)[0] == "healthy"


def test_platform_paused_is_named_and_says_which_side_is_off():
    state, detail = verdict(account("platform_paused", charges=True, payouts=False),
                            0, None, NOW)
    assert state == "paused"
    assert "payouts off" in detail
    assert "no API call reverses this" in detail


def test_a_pause_on_both_sides_says_both():
    _, detail = verdict(account("platform_paused", charges=False, payouts=False),
                        0, None, NOW)
    assert "charges and payouts off" in detail


def test_canceled_payouts_date_the_pause():
    _, detail = verdict(account("platform_paused", payouts=False),
                        4, NOW - 174 * 86400, NOW)
    assert "4 canceled payout(s)" in detail
    assert "at least 174 day(s)" in detail


def test_other_disabled_reasons_are_not_claimed_by_this_check():
    # The failure this note describes starts with somebody treating a pause as a
    # missing field. Doing the reverse is just as wrong.
    for reason in ("requirements.past_due", "rejected.fraud", "under_review",
                   "requirements.pending_verification"):
        state, detail = verdict(account(reason, charges=False, payouts=False),
                                0, None, NOW)
        assert state == "other-reason", reason
        assert reason in detail


def test_canceled_payouts_without_a_pause_are_residue():
    state, detail = verdict(account(), 3, NOW - 200 * 86400, NOW)
    assert state == "residue"
    assert "never re-issued" in detail
