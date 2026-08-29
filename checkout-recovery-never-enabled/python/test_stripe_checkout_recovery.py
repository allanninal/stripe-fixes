from stripe_checkout_recovery import verdict

NOW = 1_700_000_000
DAY = 86400


def expired_session(**recovery):
    """An expired Session with recovery enabled unless told otherwise."""
    base = {"enabled": True, "url": "https://checkout.stripe.com/c/pay/cs_test_x",
            "expires_at": NOW + 10 * DAY}
    base.update(recovery)
    return {"after_expiration": {"recovery": base},
            "consent": {"promotions": "opt_in"}}


def test_recovery_never_enabled_is_the_default_finding():
    state, detail = verdict({}, NOW)
    assert state == "no-recovery"
    assert "never will" in detail


def test_live_url_with_consent_is_recoverable():
    state, detail = verdict(expired_session(), NOW)
    assert state == "recoverable"
    assert "10.0" in detail


def test_a_url_past_its_own_expiry_is_not_recoverable():
    # 30 days from the lapse, not from the session: a weekly mail job can miss it.
    state, detail = verdict(expired_session(expires_at=NOW - 2 * DAY), NOW)
    assert state == "lapsed"
    assert "2.0" in detail


def test_a_live_url_without_consent_is_its_own_state():
    session = expired_session()
    session["consent"] = {"promotions": None}
    state, detail = verdict(session, NOW)
    assert state == "no-consent"
    assert "permission" in detail


def test_enabled_but_urlless_is_not_silently_recoverable():
    assert verdict(expired_session(url=None), NOW)[0] == "unknown"
    assert verdict(expired_session(url="  "), NOW)[0] == "unknown"
