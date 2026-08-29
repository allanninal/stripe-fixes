from stripe_report_runs import run_state, verdict


def test_succeeded_run_is_not_flagged():
    state, _ = run_state("succeeded", 120.0)
    assert state == "succeeded"


def test_pending_becomes_stalled_at_the_hour():
    # 59 minutes is still legitimately running; 60 is a run nothing is working on.
    assert run_state("pending", 3599.0)[0] == "running"
    state, detail = run_state("pending", 3600.0)
    assert state == "stalled"
    assert "1.0 hour" in detail


def test_failed_run_without_an_error_string_still_says_something():
    state, detail = run_state("failed", 30.0, None)
    assert state == "failed"
    assert "no error message" in detail


def test_all_successful_but_a_missing_day_is_not_clear():
    state, detail = verdict(["succeeded"] * 29, ["2026-08-14"], True)
    assert state == "gaps"
    assert "2026-08-14" in detail


def test_no_runs_at_all_is_the_loudest_case():
    assert verdict([], [], True)[0] == "silent"
    # Clean runs still are not clear while nothing listens for the failure event.
    assert verdict(["succeeded"], [], False)[0] == "unwatched"
    assert verdict(["succeeded"], [], True)[0] == "clear"
