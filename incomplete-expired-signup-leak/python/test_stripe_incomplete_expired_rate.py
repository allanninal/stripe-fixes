from stripe_incomplete_expired_rate import verdict


def test_the_same_count_is_noise_against_enough_activations():
    state, detail = verdict(20, 4000)
    assert state == "background"
    assert "abandonment" in detail


def test_the_same_count_is_a_leak_against_a_small_one():
    # 20 of 150 is 13% of activations: a slice of traffic cannot confirm.
    state, detail = verdict(20, 150)
    assert state == "leaking"
    assert "13.3%" in detail


def test_expired_with_no_activations_does_not_divide_by_zero():
    state, detail = verdict(31, 0, days=14)
    assert state == "broken"
    assert "not one activated" in detail


def test_a_quiet_window_is_not_reported_as_healthy_signups():
    assert verdict(0, 0)[0] == "no-signups"


def test_nothing_expired_is_clean():
    assert verdict(0, 900)[0] == "clean"
