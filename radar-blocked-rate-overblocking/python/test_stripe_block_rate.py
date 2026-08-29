from stripe_block_rate import verdict


def test_an_empty_window_is_not_a_finding():
    assert verdict(0, 0)[0] == "no-data"


def test_a_low_block_rate_is_normal():
    assert verdict(1000, 4)[0] == "normal"


def test_blocks_that_are_all_adaptive_acceptance_are_not_yours():
    # 6% raw, and not one of them came from a rule. Editing rules here changes
    # nothing at all.
    state, detail = verdict(1000, 60, 60)
    assert state == "adaptive-only"
    assert "Adaptive Acceptance" in detail


def test_a_dominant_predicate_on_normal_risk_charges_names_the_rule():
    state, detail = verdict(1000, 80, 10, (":card_country: != 'US'", 60, 58))
    assert state == "overblocking-rule"
    assert ":card_country:" in detail


def test_a_high_rate_spread_across_predicates_is_still_elevated():
    state, _ = verdict(1000, 80, 0, ("amount > 20000", 20, 18))
    assert state == "elevated"


def test_a_dominant_predicate_on_risky_charges_is_the_rule_working():
    # Same share of blocks, but Radar scored those charges risky too, so the rule
    # is agreeing with the fraud signal rather than replacing it.
    state, _ = verdict(1000, 80, 0, ("card_country != 'US'", 60, 4))
    assert state == "elevated"


def test_a_middling_rate_is_worth_watching_not_paging():
    state, detail = verdict(1000, 30)
    assert state == "watch"
    assert "series" in detail
