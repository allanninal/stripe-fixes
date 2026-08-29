from stripe_event_retention import verdict


def test_nothing_undelivered_is_clear():
    state, _ = verdict(None, 0)
    assert state == "clear"


def test_fresh_backlog_is_replayable():
    state, detail = verdict(3.0, 40)
    assert state == "replayable"
    assert "27.0" in detail


def test_twenty_days_is_the_warning_boundary():
    # Exactly 20 must already warn. A check that flips on day 21 has spent a
    # third of what is left before it says anything.
    assert verdict(19.9, 5)[0] == "replayable"
    assert verdict(20.0, 5)[0] == "aging"


def test_twenty_nine_days_is_the_last_call():
    assert verdict(28.9, 5)[0] == "aging"
    state, detail = verdict(29.0, 5)
    assert state == "expiring"
    assert "under a day" in detail


def test_count_without_a_timestamp_is_not_silently_clear():
    state, _ = verdict(None, 12)
    assert state == "unknown"
