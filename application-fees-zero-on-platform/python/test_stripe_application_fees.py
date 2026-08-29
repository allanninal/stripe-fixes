from stripe_application_fees import classify


def test_no_destination_charges_is_not_a_finding():
    state, _ = classify(0, 0, 0, 0)
    assert state == "idle"


def test_destination_charges_with_no_fees_anywhere():
    state, detail = classify(0, 480, 0, 0)
    assert state == "zero"
    assert "480" in detail


def test_under_transferring_is_revenue_that_no_report_shows():
    # The platform is keeping the difference, so the money is right and every
    # fee report is wrong. Telling someone to "add the fee" here is a mistake.
    state, detail = classify(0, 480, 0, 480)
    assert state == "invisible"
    assert "transfer_data[amount]" in detail


def test_one_code_path_missing_the_parameter():
    state, detail = classify(360, 480, 360, 0)
    assert state == "partial"
    assert "120 of 480" in detail


def test_counts_that_do_not_add_up_are_not_reported_as_healthy():
    state, _ = classify(10, 5, 4, 3)
    assert state == "unknown"
