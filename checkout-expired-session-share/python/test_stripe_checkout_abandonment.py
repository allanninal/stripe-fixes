from stripe_checkout_abandonment import verdict


def test_no_sessions_is_not_a_perfect_score():
    # An empty window divided into zero expired sessions is 0% abandonment, which
    # would report "normal" on an account that has simply stopped taking payments.
    state, _ = verdict(0, 0)
    assert state == "no-data"


def test_half_expired_is_the_boundary():
    assert verdict(100, 49)[0] == "elevated"
    assert verdict(100, 50)[0] == "abandoned"


def test_a_quarter_expired_is_only_elevated():
    assert verdict(100, 24)[0] == "normal"
    assert verdict(100, 25)[0] == "elevated"


def test_lapsed_open_sessions_are_reported_even_when_the_share_is_low():
    state, detail = verdict(100, 4, 3)
    assert state == "lapsed"
    assert "3 open session(s)" in detail


def test_a_healthy_account_still_reports_the_percentage():
    state, detail = verdict(640, 118)
    assert state == "normal"
    assert "18.4%" in detail
