from stripe_endpoint_api_version import verdict


def test_null_is_unpinned():
    state, _ = verdict(None)
    assert state == "unpinned"


def test_empty_string_is_also_unpinned():
    # The trap: `if ep.api_version is not None` calls this pinned, then compares
    # an empty string against a date and reports it as the oldest pin on record.
    state, _ = verdict("")
    assert state == "unpinned"


def test_pre_acacia_is_hard_flagged():
    state, detail = verdict("2022-11-15")
    assert state == "ancient"
    assert "2024-09-30" in detail


def test_the_suffix_is_trimmed_before_comparing():
    # "2024-09-30.acacia" > "2025-09-30" as a naive string compare is False, but
    # "2025-09-30.clover" > "2025-09-30" is True, so the suffix has to go first.
    assert verdict("2024-09-30.acacia")[0] == "stale"
    assert verdict("2025-09-30.clover")[0] == "current"


def test_a_version_with_no_date_is_not_silently_current():
    state, _ = verdict("beta")
    assert state == "unreadable"
