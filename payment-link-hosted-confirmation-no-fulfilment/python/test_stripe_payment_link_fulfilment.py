from stripe_payment_link_fulfilment import listens_for_completion, verdict

REDIRECT = {"type": "redirect",
            "redirect": {"url": "https://example.com/after"
                                "?session_id={CHECKOUT_SESSION_ID}"}}


def test_hosted_confirmation_without_a_webhook_fulfils_nothing():
    state, detail = verdict({"after_completion": {"type": "hosted_confirmation"}},
                            False)
    assert state == "unfulfilled"
    assert "nothing fulfils" in detail


def test_the_same_link_with_a_webhook_is_only_untidy():
    # Identical link object; only the account-wide fact changed.
    state, _ = verdict({"after_completion": {"type": "hosted_confirmation"}}, True)
    assert state == "webhook-only"


def test_a_missing_after_completion_is_treated_as_the_default():
    assert verdict({}, False)[0] == "unfulfilled"


def test_a_redirect_without_the_placeholder_is_blind():
    state, detail = verdict(
        {"after_completion": {"type": "redirect",
                              "redirect": {"url": "https://example.com/thanks"}}},
        True)
    assert state == "blind-redirect"
    assert "CHECKOUT_SESSION_ID" in detail


def test_a_good_redirect_still_needs_the_event_subscribed():
    assert verdict({"after_completion": REDIRECT}, True)[0] == "covered"
    assert verdict({"after_completion": REDIRECT}, False)[0] == "landing-only"


def test_only_enabled_endpoints_count_and_a_wildcard_does():
    assert listens_for_completion(
        [{"status": "enabled", "enabled_events": ["*"]}]) is True
    assert listens_for_completion(
        [{"status": "disabled",
          "enabled_events": ["checkout.session.completed"]}]) is False
    assert listens_for_completion([]) is False
