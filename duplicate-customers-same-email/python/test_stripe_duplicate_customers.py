from stripe_duplicate_customers import normalise, verdict


def rec(cid, card=False, sub=False):
    return {"id": cid, "has_card": card, "has_subscription": sub}


def test_normalisation_folds_case_and_whitespace():
    assert normalise("  Ada@Example.COM ") == "ada@example.com"
    assert normalise("") is None
    assert normalise(None) is None


def test_a_single_record_is_not_a_duplicate():
    assert verdict([rec("cus_1", card=True)])[0] == "unique"


def test_two_live_subscriptions_is_the_billing_case():
    state, detail = verdict([rec("cus_1", sub=True), rec("cus_2", sub=True)])
    assert state == "split_billing"
    assert "cancelling one" in detail


def test_two_records_holding_cards_is_a_support_problem_not_a_billing_one():
    state, _ = verdict([rec("cus_1", card=True), rec("cus_2", card=True)])
    assert state == "split_methods"


def test_duplicates_holding_nothing_are_ranked_below_ones_that_do():
    assert verdict([rec("cus_1", card=True), rec("cus_2")])[0] == "shells"
    assert verdict([rec("cus_1"), rec("cus_2"), rec("cus_3")])[0] == "empty"
