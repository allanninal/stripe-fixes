from stripe_duplicate_endpoints import normalise, verdict


def test_query_string_does_not_make_a_new_destination():
    # Stripe's version-upgrade guide tells you to add exactly this parameter.
    a = normalise("https://example.com/stripe/webhook?v=2025-09-30")
    b = normalise("https://example.com/stripe/webhook")
    assert a == b


def test_trailing_slash_and_host_case_are_ignored():
    a = normalise("https://Example.COM/stripe/webhook/")
    b = normalise("https://example.com/stripe/webhook")
    assert a == b


def test_different_paths_stay_different():
    assert normalise("https://example.com/a") != normalise("https://example.com/b")


def test_two_enabled_endpoints_on_one_url_is_the_finding():
    state, detail = verdict([{"status": "enabled"}, {"status": "enabled"}])
    assert state == "duplicate"
    assert "2 times" in detail


def test_one_enabled_beside_a_disabled_one_is_only_residue():
    state, _ = verdict([{"status": "enabled"}, {"status": "disabled"}])
    assert state == "residue"


def test_a_single_endpoint_is_unique():
    assert verdict([{"status": "enabled"}])[0] == "unique"
