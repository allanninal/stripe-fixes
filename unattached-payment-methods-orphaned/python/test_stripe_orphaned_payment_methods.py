from stripe_orphaned_payment_methods import verdict


def test_nothing_to_judge_is_clear():
    assert verdict(0, 0, 0, 0)[0] == "clear"


def test_all_attached_is_clear():
    state, detail = verdict(0, 40, 0, 0)
    assert state == "clear"
    assert "attached" in detail


def test_a_failed_reuse_outranks_every_hygiene_finding():
    # Small orphan count, tiny ratio, but a customer is failing at checkout now.
    state, detail = verdict(1, 999, 0, 3)
    assert state == "burned"
    assert "payment_method_unexpected_state" in detail


def test_half_the_cards_orphaned_is_the_live_path():
    state, detail = verdict(50, 50, 0, 0)
    assert state == "leaking"
    assert "50%" in detail


def test_the_warn_ratio_is_inclusive():
    # 24% is residue, 25% is a code path. Off by one on this boundary reports
    # an active leak as history.
    assert verdict(2, 8, 0, 0)[0] == "residue"
    assert verdict(25, 75, 0, 0)[0] == "orphaned"


def test_unsaved_intents_are_named_even_with_few_orphans():
    state, detail = verdict(3, 97, 12, 0)
    assert state == "unsaved"
    assert "setup_future_usage" in detail
