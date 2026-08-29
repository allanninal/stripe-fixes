from stripe_manual_payout_schedule import classify


def manual(payouts_enabled=True, delay=2):
    return {"payouts_enabled": payouts_enabled,
            "settings": {"payouts": {"schedule": {"interval": "manual",
                                                  "delay_days": delay}}}}


def test_manual_with_money_and_no_payout_ever_is_stranded():
    state, detail = classify(manual(), 480000, None)
    assert state == "stranded"
    assert "no payout has ever been created" in detail


def test_manual_with_money_and_a_recent_payout_is_a_running_job():
    # Somebody chose manual and wrote the job. Do not page anyone.
    state, _ = classify(manual(), 480000, 3.0)
    assert state == "manual"


def test_thirty_days_is_the_boundary():
    assert classify(manual(), 100, 29.9)[0] == "manual"
    assert classify(manual(), 100, 30.0)[0] == "stranded"


def test_manual_with_an_empty_balance_is_not_an_incident():
    assert classify(manual(), 0, None)[0] == "manual"


def test_payouts_disabled_is_a_different_problem():
    state, detail = classify(manual(payouts_enabled=False), 90000, None)
    assert state == "disabled"
    assert "requirements first" in detail


def test_inflated_delay_days_is_flagged_separately():
    acct = {"payouts_enabled": True,
            "settings": {"payouts": {"schedule": {"interval": "weekly",
                                                  "delay_days": 30}}}}
    state, detail = classify(acct, None, None)
    assert state == "slow"
    assert "delay_days=30" in detail


def test_an_ordinary_daily_schedule_is_quiet():
    acct = {"payouts_enabled": True,
            "settings": {"payouts": {"schedule": {"interval": "daily",
                                                  "delay_days": 2}}}}
    assert classify(acct, None, None)[0] == "scheduled"
