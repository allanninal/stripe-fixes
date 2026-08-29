from stripe_dispute_forfeits import verdict


def test_no_closed_disputes_is_not_a_perfect_record():
    state, _ = verdict(0, 0, 0)
    assert state == "no_disputes"


def test_losses_that_were_all_answered_report_the_real_loss_rate():
    # 4 losses, none forfeited, 6 wins: 4 of 10 contested disputes lost.
    state, detail = verdict(4, 0, 6)
    assert state == "contested"
    assert "40%" in detail


def test_forfeits_are_excluded_from_the_contested_loss_rate():
    # 10 losses, 2 forfeited, 8 wins: the contested rate is 8 of 16, not 10 of 18.
    state, detail = verdict(10, 2, 8)
    assert state == "leaking"
    assert "16 contested" in detail
    assert "50%" in detail


def test_thirty_percent_forfeits_is_the_alarm_and_it_is_inclusive():
    assert verdict(100, 29, 0)[0] == "leaking"
    state, detail = verdict(10, 3, 0)
    assert state == "absent"
    assert "no dispute workflow" in detail


def test_every_loss_forfeited_has_no_loss_rate_to_quote():
    state, detail = verdict(5, 5, 0)
    assert state == "absent"
    assert "nothing was contested" in detail
    assert verdict(1, 2, 0)[0] == "unknown"
