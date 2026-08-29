from stripe_wildcard_events import verdict

FIRED = ["payment_intent.succeeded", "charge.refunded", "invoice.paid"]


def test_literal_star_is_a_wildcard():
    state, detail = verdict(["*"], FIRED)
    assert state == "wildcard"
    assert "3" in detail


def test_a_long_explicit_list_is_a_wildcard_typed_out():
    # The case a naive check misses: no star anywhere, same load.
    state, _ = verdict(["evt.%d" % i for i in range(60)], FIRED)
    assert state == "overbroad"


def test_subscribed_types_that_never_fire_are_reported():
    state, detail = verdict(["payment_intent.succeeded", "issuing_card.created"],
                            FIRED)
    assert state == "padded"
    assert "issuing_card.created" in detail


def test_a_list_matching_real_traffic_is_focused():
    state, _ = verdict(FIRED, FIRED)
    assert state == "focused"


def test_empty_enabled_events_is_not_focused():
    state, _ = verdict([], FIRED)
    assert state == "empty"
