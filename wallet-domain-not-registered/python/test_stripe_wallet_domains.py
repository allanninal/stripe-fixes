from stripe_wallet_domains import dark_wallets, verdict, missing_domains

ACTIVE = {"status": "active"}


def healthy(name="example.com"):
    return {"domain_name": name, "livemode": True, "enabled": True,
            "apple_pay": dict(ACTIVE), "google_pay": dict(ACTIVE),
            "link": dict(ACTIVE), "paypal": dict(ACTIVE)}


def test_a_fully_active_domain_has_no_dark_wallets():
    assert dark_wallets(healthy()) == []


def test_a_dark_wallet_carries_stripes_reason():
    d = healthy()
    d["apple_pay"] = {"status": "inactive", "status_details":
                      {"error_message": "association file not found"}}
    assert dark_wallets(d) == [("apple_pay", "inactive",
                                "association file not found")]


def test_a_dark_wallet_without_a_message_still_reports():
    d = healthy()
    d["link"] = {"status": "inactive"}
    assert dark_wallets(d) == [("link", "inactive", "no reason given")]


def test_a_test_mode_registration_is_not_a_pass():
    # This is what people find when they check, and why they stop checking.
    d = healthy()
    d["livemode"] = False
    state, _, _ = verdict(d)
    assert state == "test_only"


def test_a_disabled_domain_is_not_a_pass():
    d = healthy()
    d["enabled"] = False
    assert verdict(d)[0] == "disabled"


def test_one_dark_wallet_fails_the_whole_domain():
    d = healthy()
    d["google_pay"] = {"status": "inactive"}
    state, detail, dark = verdict(d)
    assert state == "dark"
    assert "1" in detail and len(dark) == 1


def test_a_live_enabled_active_domain_passes():
    assert verdict(healthy())[0] == "active"


def test_a_subdomain_is_missing_even_when_the_apex_is_healthy():
    registered = [healthy("example.com")]
    assert missing_domains(registered, ["example.com", "checkout.example.com"]) == \
        ["checkout.example.com"]


def test_nothing_is_missing_when_every_host_is_registered():
    registered = [healthy("example.com"), healthy("checkout.example.com")]
    assert missing_domains(registered, ["checkout.example.com"]) == []
