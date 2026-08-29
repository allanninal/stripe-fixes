from stripe_webhook_url_check import verdict


def test_a_public_https_url_is_fine():
    state, _ = verdict("https://example.com/stripe/webhook", True)
    assert state == "ok"


def test_a_tunnel_host_in_live_mode_is_flagged():
    state, detail = verdict("https://a1b2.eu.ngrok.io/stripe/webhook", True)
    assert state == "tunnel"
    assert "ngrok.io" in detail


def test_the_same_tunnel_host_in_test_mode_is_not_a_fault():
    # The whole point of a tunnel is local development. Only live mode matters.
    state, _ = verdict("https://a1b2.eu.ngrok.io/stripe/webhook", False)
    assert state == "dev"


def test_a_private_address_is_unroutable():
    assert verdict("https://10.4.1.9/stripe/webhook", True)[0] == "unroutable"
    assert verdict("http://localhost:4242/webhook", True)[0] == "unroutable"


def test_plain_http_on_a_public_host_is_flagged():
    state, detail = verdict("http://example.com/stripe/webhook", True)
    assert state == "plaintext"
    assert "TLS 1.2" in detail


def test_a_hostname_containing_localhost_is_not_flagged():
    # Suffix matching, not substring: this is a real production host.
    assert verdict("https://localhost-tools.example.com/hook", True)[0] == "ok"


def test_a_missing_url_is_reported_not_passed():
    assert verdict(None, True)[0] == "unparseable"
    assert verdict("example.com/webhook", True)[0] == "unparseable"
