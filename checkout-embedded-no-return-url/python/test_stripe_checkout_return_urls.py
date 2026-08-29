from stripe_checkout_return_urls import verdict

RETURN = "https://example.com/after-checkout?session_id={CHECKOUT_SESSION_ID}"


def test_embedded_with_a_return_url_is_ok():
    state, _ = verdict({"ui_mode": "embedded_page", "return_url": RETURN,
                        "redirect_on_completion": "if_required"})
    assert state == "ok"


def test_embedded_without_a_return_url_is_stranded():
    state, detail = verdict({"ui_mode": "embedded_page", "return_url": None})
    assert state == "stranded"
    assert "nowhere" in detail
    assert verdict({"ui_mode": "embedded_page", "return_url": "  "})[0] == "stranded"


def test_never_plus_a_redirect_method_beats_a_valid_return_url():
    # Every field here is individually fine; together they remove iDEAL entirely.
    state, detail = verdict({"ui_mode": "embedded_page", "return_url": RETURN,
                             "redirect_on_completion": "never",
                             "payment_method_types": ["card", "ideal"]})
    assert state == "blocked"
    assert "ideal" in detail


def test_hosted_success_url_without_the_placeholder_is_unjoinable():
    state, detail = verdict({"ui_mode": "hosted_page",
                             "success_url": "https://example.com/thanks"})
    assert state == "unjoinable"
    assert "CHECKOUT_SESSION_ID" in detail
    assert verdict({"success_url": "https://example.com/thanks"})[0] == "unjoinable"


def test_an_unrecognised_ui_mode_is_not_silently_ok():
    assert verdict({"ui_mode": "kiosk"})[0] == "unknown"
