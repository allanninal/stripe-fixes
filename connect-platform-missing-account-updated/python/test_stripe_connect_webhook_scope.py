from stripe_connect_webhook_scope import coverage


def endpoint(events, status="enabled", url="https://example.com/hook"):
    return {"id": "we_1", "status": status, "url": url, "enabled_events": events}


def test_a_plain_account_is_not_asked_about_connect_scope():
    state, detail = coverage([endpoint(["charge.succeeded"])], False)
    assert state == "not-a-platform"
    assert "no connected accounts" in detail


def test_both_connect_signals_present_is_covered():
    state, _ = coverage(
        [endpoint(["account.updated", "account.application.deauthorized"])], True)
    assert state == "covered"


def test_neither_signal_is_uncovered():
    state, detail = coverage([endpoint(["charge.succeeded", "payout.paid"])], True)
    assert state == "uncovered"
    assert "account.updated" in detail


def test_a_disabled_endpoint_does_not_count_as_coverage():
    # A disabled endpoint delivers nothing, so it is the same as not having one.
    # It still gets mentioned, because "we do have that endpoint" is the first
    # thing anybody says.
    state, detail = coverage(
        [endpoint(["charge.succeeded"]),
         endpoint(["account.updated", "account.application.deauthorized"],
                  status="disabled")], True)
    assert state == "uncovered"
    assert "1 disabled endpoint(s) were ignored" in detail


def test_a_wildcard_is_inconclusive_rather_than_covered():
    # A wildcard endpoint would receive these events if it were Connect scoped,
    # and the object does not say whether it is. Reporting that honestly is the
    # whole point.
    state, detail = coverage([endpoint(["*"])], True)
    assert state == "inconclusive"
    assert "Workbench" in detail


def test_account_updated_without_deauthorized_is_half_a_subscription():
    state, detail = coverage([endpoint(["account.updated"])], True)
    assert state == "thin"
    assert "disconnect" in detail


def test_no_enabled_endpoint_at_all_says_so_first():
    state, detail = coverage([endpoint(["*"], status="disabled")], True)
    assert state == "no-endpoints"
    assert "nothing is being delivered anywhere" in detail
