from stripe_statement_descriptor import verdict


def test_no_prefix_is_the_first_finding():
    state, detail = verdict(None, ["EXAMPLE STORE"])
    assert state == "unset"
    assert "1 distinct" in detail
    assert verdict("   ", [])[0] == "unset"


def test_two_flows_with_two_descriptors_is_fragmentation():
    state, detail = verdict("EXAMPLE", ["EXAMPLE STORE", "EXAMPLE SUBS", "EXAMPLE STORE"])
    assert state == "fragmented"
    assert "2 distinct" in detail


def test_a_configured_prefix_with_empty_descriptors_is_worse_than_missing():
    assert verdict("EXAMPLE", ["", "  ", None])[0] == "blank"


def test_the_format_rules_are_checked_at_their_boundaries():
    assert verdict("EXAMPLE", ["ABCD"])[0] == "malformed"          # 4 chars
    assert verdict("EXAMPLE", ["ABCDE"])[0] == "consistent"        # 5 is the floor
    assert verdict("EXAMPLE", ["A" * 23])[0] == "malformed"        # 23 chars
    assert verdict("EXAMPLE", ["AB 12"])[0] == "malformed"         # only 2 letters


def test_a_disallowed_character_is_rejected():
    state, detail = verdict("EXAMPLE", ["EXAMPLE<STORE"])
    assert state == "malformed"
    assert "disallows" in detail
