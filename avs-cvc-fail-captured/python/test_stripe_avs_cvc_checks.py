from stripe_avs_cvc_checks import verdict

OFF = {"avs_failure": False, "cvc_failure": False}
ON = {"avs_failure": True, "cvc_failure": True}


def test_non_card_charges_are_out_of_scope():
    assert verdict(None, True, OFF)[0] == "not_card"


def test_all_null_checks_means_nothing_was_ever_collected():
    # Not the same as passing. There was no AVS request to fail, so no rule
    # would have helped: the checkout form is the thing to fix.
    state, detail = verdict({}, True, OFF)
    assert state == "uncollected"
    assert "never collected" in detail


def test_a_failed_check_on_a_captured_charge_names_the_missing_setting():
    checks = {"cvc_check": "pass", "address_postal_code_check": "fail",
              "address_line1_check": "pass"}
    state, detail = verdict(checks, True, OFF)
    assert state == "captured_on_fail"
    assert "address_postal_code_check" in detail


def test_a_failure_the_account_declines_on_is_a_different_problem():
    checks = {"cvc_check": "fail", "address_postal_code_check": "pass",
              "address_line1_check": "pass"}
    assert verdict(checks, True, ON)[0] == "captured_despite_setting"
    # Uncaptured is still a live decision, whatever the settings say.
    assert verdict(checks, False, OFF)[0] == "held"


def test_passing_and_inconclusive_checks_are_told_apart():
    passed = {"cvc_check": "pass", "address_postal_code_check": "pass",
              "address_line1_check": "pass"}
    assert verdict(passed, True, OFF)[0] == "verified"
    partial = dict(passed, address_line1_check="unavailable")
    assert verdict(partial, True, OFF)[0] == "unverified"
