from stripe_checkout_guests import email_counts, verdict


def make(email=None, **kw):
    s = {"mode": "payment", "customer_creation": "if_required"}
    if email is not None:
        s["customer_details"] = {"email": email}
    s.update(kw)
    return s


def test_a_session_with_a_customer_is_linked():
    state, detail = verdict(make("a@example.com", customer="cus_9"))
    assert state == "linked"
    assert "cus_9" in detail


def test_the_default_flag_produces_a_guest():
    state, detail = verdict(make("a@example.com"))
    assert state == "guest"
    assert "if_required" in detail


def test_the_same_address_twice_is_a_repeat_guest():
    # The point of the note: no single session shows this, only the window does.
    sessions = [make("buyer@example.com"), make("BUYER@example.com")]
    counts = email_counts(sessions)
    state, detail = verdict(sessions[0], counts["buyer@example.com"])
    assert state == "repeat-guest"
    assert "2" in detail


def test_a_guest_with_no_email_is_not_merely_a_guest():
    assert verdict(make())[0] == "anonymous"
    assert verdict(make("   "))[0] == "anonymous"


def test_subscription_mode_and_always_are_not_silently_guests():
    assert verdict(make("a@example.com", mode="subscription"))[0] == "unknown"
    assert verdict(make("a@example.com", customer_creation="always"))[0] == "unknown"
