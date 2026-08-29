from stripe_highest_risk_succeeded import verdict


def test_normal_risk_is_out_of_scope():
    assert verdict("normal", "succeeded", True, None)[0] == "baseline"


def test_unscored_charges_are_called_out_before_anything_else():
    # A charge Radar never scored cannot be blocked by any rule, so tuning
    # rules on an account full of these is wasted work.
    assert verdict("not_assessed", "succeeded", True, None)[0] == "not_assessed"
    assert verdict(None, "succeeded", True, None)[0] == "not_assessed"


def test_highest_risk_that_did_not_succeed_is_the_block_working():
    state, detail = verdict("highest", "failed", False, None)
    assert state == "stopped"
    assert "the block held" in detail


def test_an_allow_rule_is_named_when_it_overrode_the_default():
    rule = {"id": "rule_123", "action": "allow", "predicate": ":ip_country: = 'GB'"}
    state, detail = verdict("highest", "succeeded", True, rule)
    assert state == "allowed"
    assert ":ip_country: = 'GB'" in detail


def test_captured_with_no_rule_means_the_default_is_off():
    assert verdict("highest", "succeeded", True, None)[0] == "leaked"
    # A rule id string with no action is not evidence of an allow rule.
    assert verdict("highest", "succeeded", True, "rule_123")[0] == "leaked"
    # Still holdable, so it is a different instruction to a human.
    assert verdict("highest", "succeeded", False, None)[0] == "uncaptured"
