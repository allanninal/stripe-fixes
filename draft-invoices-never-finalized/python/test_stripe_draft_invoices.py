from stripe_draft_invoices import verdict


def test_recent_drafts_are_not_a_finding():
    # Everything under the cutoff is either finalizing normally or inside the
    # 72-hour deferral window. Reporting those buries the real ones.
    assert verdict(29.9, False, None, 5000)[0] == "fresh"
    assert verdict(30.0, False, None, 5000)[0] == "stranded"


def test_auto_advance_false_is_stranded_not_late():
    state, detail = verdict(90.0, False, None, 12000)
    assert state == "stranded"
    assert "none will be" in detail


def test_zero_amount_is_clutter_before_it_is_stranded():
    # Checked ahead of auto_advance on purpose: nobody should be asked to
    # finalize an invoice worth nothing.
    assert verdict(90.0, False, None, 0)[0] == "empty"


def test_auto_advance_true_with_no_schedule_is_unscheduled():
    state, _ = verdict(45.0, True, None, 8000)
    assert state == "unscheduled"


def test_a_past_finalization_time_means_it_failed():
    state, detail = verdict(45.0, True, -3.0, 8000)
    assert state == "blocked"
    assert "last_finalization_error" in detail


def test_a_future_finalization_time_is_left_alone():
    assert verdict(45.0, True, 0.5, 8000)[0] == "scheduled"
