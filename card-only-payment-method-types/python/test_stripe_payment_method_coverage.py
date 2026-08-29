from stripe_payment_method_coverage import is_card_only, enabled_methods, verdict


def test_bare_card_list_is_hardcoded():
    assert is_card_only({"payment_method_types": ["card"]})


def test_card_plus_link_is_still_hardcoded():
    # Link gets added to the array instead of the array being removed.
    assert is_card_only({"payment_method_types": ["link", "card"]})


def test_dynamic_intent_that_resolved_to_card_is_not_hardcoded():
    # The whole point: same types, different origin.
    assert not is_card_only({
        "automatic_payment_methods": {"enabled": True},
        "payment_method_types": ["card"],
    })


def test_a_longer_explicit_list_is_not_flagged():
    assert not is_card_only({"payment_method_types": ["card", "ideal"]})


def test_enabled_methods_ignores_metadata_and_off_methods():
    configs = [{
        "id": "pmc_1", "object": "payment_method_configuration", "name": "default",
        "card": {"available": True, "display_preference": {"value": "on"}},
        "ideal": {"available": True, "display_preference": {"value": "off"}},
        "klarna": {"available": False, "display_preference": {"value": "on"}},
    }]
    assert enabled_methods(configs) == {"card"}


def test_mostly_hardcoded_names_the_methods_going_to_waste():
    stats = {"intents": 100, "card_only": 95, "offered": ["card"]}
    state, detail = verdict(stats, {"card", "ideal", "klarna"})
    assert state == "hardcoded"
    assert "ideal, klarna" in detail


def test_a_minority_is_a_half_finished_migration():
    stats = {"intents": 100, "card_only": 12, "offered": ["card", "ideal"]}
    state, _ = verdict(stats, {"card", "ideal"})
    assert state == "partial"


def test_nothing_hardcoded_but_a_method_never_offered_is_eligibility():
    stats = {"intents": 100, "card_only": 0, "offered": ["card"]}
    state, detail = verdict(stats, {"card", "klarna"})
    assert state == "unused"
    assert "eligibility" in detail


def test_full_coverage_is_healthy():
    stats = {"intents": 40, "card_only": 0, "offered": ["card", "ideal"]}
    assert verdict(stats, {"card", "ideal"})[0] == "healthy"


def test_an_empty_window_is_not_reported_as_healthy():
    assert verdict({"intents": 0}, {"card"})[0] == "no_data"
