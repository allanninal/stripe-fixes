from stripe_requires_action import classify

NOW = 1_800_000_000


def pi(status="requires_action", age_h=48, action="redirect_to_url"):
    out = {"status": status, "created": NOW - age_h * 3600}
    if action is not None:
        out["next_action"] = {"type": action}
    return out


def test_old_requires_action_is_abandoned():
    state, detail = classify(pi(age_h=48), NOW)
    assert state == "abandoned"
    assert "redirect_to_url" in detail


def test_recent_requires_action_is_not_abandoned():
    # A customer reading a bank prompt is not a broken integration.
    state, _ = classify(pi(age_h=1), NOW)
    assert state == "in-flight"


def test_empty_next_action_is_its_own_state():
    # Nobody could have completed this one, so it is a different bug.
    state, detail = classify(pi(age_h=48, action=None), NOW)
    assert state == "no-next-action"
    assert "never" in detail


def test_other_statuses_are_left_alone():
    assert classify(pi(status="succeeded"), NOW)[0] == "other"


def test_missing_created_is_not_silently_healthy():
    assert classify({"status": "requires_action"}, NOW)[0] == "unknown"
