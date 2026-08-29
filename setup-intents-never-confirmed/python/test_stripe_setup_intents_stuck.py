from stripe_setup_intents_stuck import verdict


def test_an_empty_window_is_clear():
    assert verdict(0, 0, 0, 0)[0] == "clear"


def test_everything_resolved_is_clear():
    state, detail = verdict(312, 0, 0, 0)
    assert state == "clear"
    assert "312" in detail


def test_nineteen_percent_is_ordinary_drop_off():
    assert verdict(100, 19, 0, 0)[0] == "abandonment"


def test_twenty_percent_is_a_broken_path():
    # The boundary is inclusive. One percentage point either side is the
    # difference between a report nobody acts on and one that names the bug.
    state, detail = verdict(100, 20, 0, 0)
    assert state == "no-payment-method"
    assert "last_setup_error" in detail


def test_a_pile_at_requires_confirmation_names_the_client():
    state, detail = verdict(100, 5, 40, 2)
    assert state == "unconfirmed"
    assert "confirmSetup" in detail


def test_requires_action_points_at_the_return_url():
    state, detail = verdict(100, 5, 10, 40)
    assert state == "return-url"
    assert "return_url" in detail


def test_a_tie_is_broken_deterministically():
    # Level buckets must not depend on iteration order: requires_action first,
    # then requires_confirmation.
    assert verdict(100, 20, 20, 20)[0] == "return-url"
    assert verdict(100, 20, 20, 0)[0] == "unconfirmed"
