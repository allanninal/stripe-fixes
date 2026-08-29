from stripe_endpoint_version_drift import base_url, normalise, verdict


def test_null_and_empty_string_are_one_version_not_two():
    # The trap. Deduplicating the raw field reports drift on an account where
    # both endpoints simply follow the account default.
    assert normalise(None) == normalise("")
    state, _ = verdict([
        {"url": "https://a.example/hook", "api_version": None, "status": "enabled"},
        {"url": "https://b.example/hook", "api_version": "", "status": "enabled"},
    ])
    assert state == "consistent"


def test_a_disabled_endpoint_never_counts():
    # It delivers nothing, so its pin cannot put a second shape on the wire.
    state, _ = verdict([
        {"url": "https://a.example/hook", "api_version": "2025-09-30.clover",
         "status": "enabled"},
        {"url": "https://old.example/hook", "api_version": "2019-12-03",
         "status": "disabled"},
    ])
    assert state == "consistent"


def test_one_pinned_and_one_unpinned_is_drift():
    state, detail = verdict([
        {"url": "https://a.example/hook", "api_version": "2025-09-30.clover",
         "status": "enabled"},
        {"url": "https://b.example/hook", "api_version": None, "status": "enabled"},
    ])
    assert state == "drift"
    assert "account default" in detail


def test_same_url_differing_only_by_query_is_an_unfinished_migration():
    state, detail = verdict([
        {"url": "https://a.example/hook", "api_version": "2024-09-30.acacia",
         "status": "enabled"},
        {"url": "https://a.example/hook?version=2025-09-30",
         "api_version": "2025-09-30.clover", "status": "enabled"},
    ])
    assert state == "migration"
    assert "https://a.example/hook" in detail
    assert base_url("https://a.example/hook?version=x") == "https://a.example/hook"


def test_no_enabled_endpoints_is_not_reported_as_consistent():
    state, _ = verdict([{"url": "https://a.example/hook", "api_version": None,
                         "status": "disabled"}])
    assert state == "none"
