from stripe_sigma_runs import run_state, verdict


def test_completed_run_with_a_live_result_is_fine():
    state, _ = run_state("completed", None, 3 * 86400.0)
    assert state == "completed"


def test_completed_but_expired_is_its_own_state():
    # status says completed and the data is gone. Collapsing this into "completed"
    # is how a pipeline reports success while downloading nothing.
    state, detail = run_state("completed", None, -7200.0)
    assert state == "expired"
    assert "2.0 hour(s) ago" in detail


def test_timed_out_is_distinguished_from_failed_and_canceled():
    assert run_state("timed_out", None, None)[0] == "timed_out"
    assert run_state("failed", "syntax error at or near FROM", None)[1].startswith("syntax")
    assert run_state("canceled", None, None)[0] == "canceled"


def test_all_completed_but_the_schedule_has_stopped():
    # Weekly cadence, newest run 19 days old: every run succeeded and the schedule
    # is dead. This is the six-week silence, caught by arithmetic rather than status.
    state, detail = verdict(["completed"] * 8, 456.0, 168.0, True)
    assert state == "missing"
    assert "stopped producing runs" in detail


def test_completed_runs_with_no_subscriber_are_not_clear():
    assert verdict(["completed"], 6.0, 24.0, False)[0] == "email_only"
    assert verdict(["completed"], 6.0, 24.0, True)[0] == "clear"
    assert verdict([], None, 24.0, True)[0] == "silent"
