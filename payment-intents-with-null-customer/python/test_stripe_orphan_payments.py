from stripe_orphan_payments import verdict


def test_a_repeat_fingerprint_outranks_a_tiny_share():
    # 6 of 4000 is noise. One of those cards paying twice is not.
    state, detail = verdict(4000, 6, 2)
    assert state == "repeat"
    assert "2" in detail


def test_majority_orphaned_means_guest_checkout_is_the_default():
    assert verdict(1000, 499, 0)[0] == "guests"
    state, _ = verdict(1000, 500, 0)
    assert state == "dominant"


def test_a_few_orphans_are_reported_without_alarm():
    state, detail = verdict(1000, 30, 0)
    assert state == "guests"
    assert "deliberate" in detail


def test_every_intent_attached_is_clear():
    assert verdict(1000, 0, 0)[0] == "clear"


def test_an_empty_window_is_not_silently_clear():
    assert verdict(0, 0, 0)[0] == "unknown"
