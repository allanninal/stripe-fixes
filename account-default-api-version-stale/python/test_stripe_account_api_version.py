from stripe_account_api_version import authority, verdict

TODAY = "2026-01-15"


def test_nothing_readable_is_not_reported_as_current():
    version, note = authority(None, None)
    assert version is None
    assert verdict(version, TODAY)[0] == "unknown"
    assert "30 day" in note


def test_the_header_wins_and_the_disagreement_is_named():
    # The header is the default now. The event is the default when it fired.
    version, note = authority("2024-09-30.acacia", "2025-09-30.clover")
    assert version == "2025-09-30.clover"
    assert "2024-09-30.acacia" in note and "72 hour" in note


def test_over_a_year_behind_is_stale_and_under_it_is_not():
    assert verdict("2024-09-30.acacia", TODAY)[0] == "stale"
    assert verdict("2025-03-31.basil", TODAY)[0] == "trailing"


def test_the_release_line_suffix_is_trimmed_before_comparing():
    # "2025-09-30.clover" as a raw string is greater than "2025-09-30", so the
    # date has to be cut off the front before anything is ordered.
    assert verdict("2025-09-30.clover", TODAY)[0] == "current"


def test_a_version_with_no_date_is_not_silently_current():
    assert verdict("beta", TODAY)[0] == "unreadable"
