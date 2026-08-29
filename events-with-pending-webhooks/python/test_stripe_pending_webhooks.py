from stripe_pending_webhooks import verdict


def test_an_empty_sample_reports_nothing_rather_than_dividing_by_zero():
    state, _ = verdict(0, 0, "none", 0)
    assert state == "empty"


def test_everything_delivered_is_clear():
    state, detail = verdict(412, 0, "none", 0)
    assert state == "clear"
    assert "412" in detail


def test_one_type_dominating_names_the_branch():
    state, detail = verdict(500, 40, "invoice.payment_failed", 36)
    assert state == "one-branch"
    assert "invoice.payment_failed" in detail


def test_the_concentration_threshold_is_inclusive():
    # 80 of 100 is a branch; 79 of 100 is not.
    assert verdict(1000, 100, "charge.refunded", 80)[0] == "one-branch"
    assert verdict(1000, 100, "charge.refunded", 79)[0] != "one-branch"


def test_a_majority_stuck_across_types_is_the_endpoint():
    state, detail = verdict(100, 60, "payment_intent.succeeded", 20)
    assert state == "endpoint-wide"
    assert "redirect" in detail


def test_a_thin_spread_is_load_not_a_bad_branch():
    state, detail = verdict(1000, 40, "payment_intent.succeeded", 12)
    assert state == "intermittent"
    assert "under load" in detail
