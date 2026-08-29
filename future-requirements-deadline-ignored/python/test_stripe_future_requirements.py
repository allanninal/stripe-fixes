from stripe_future_requirements import verdict

NOW = 1_700_000_000
APP = {"requirement_collection": "application"}


def account(**future):
    return {"controller": APP, "future_requirements": future}


def test_stripe_collected_accounts_are_never_reported():
    # Stripe chases the owner and applies the update itself, so an alert here is
    # noise nobody can act on.
    acct = {"controller": {"requirement_collection": "stripe"},
            "future_requirements": {"currently_due": ["id_number"],
                                    "current_deadline": NOW + 3600}}
    assert verdict(acct, NOW)[0] == "stripe-managed"


def test_a_distant_deadline_is_scheduled():
    state, _ = verdict(account(currently_due=["id_number"],
                               current_deadline=NOW + 42 * 86400), NOW)
    assert state == "scheduled"


def test_the_same_account_is_urgent_inside_the_window():
    state, detail = verdict(account(currently_due=["id_number"],
                                    current_deadline=NOW + 5 * 86400), NOW)
    assert state == "due-soon"
    assert "id_number" in detail


def test_an_elapsed_deadline_is_overdue_not_merely_urgent():
    state, _ = verdict(account(currently_due=["id_number"],
                               current_deadline=NOW - 86400), NOW)
    assert state == "overdue"


def test_future_entries_without_a_deadline_are_their_own_state():
    state, _ = verdict(account(currently_due=["id_number"], current_deadline=None), NOW)
    assert state == "undated"


def test_eventually_due_alone_is_not_urgent_and_not_silent():
    assert verdict(account(eventually_due=["id_number"]), NOW)[0] == "eventual"


def test_an_empty_future_hash_is_clear():
    assert verdict(account(), NOW)[0] == "clear"
