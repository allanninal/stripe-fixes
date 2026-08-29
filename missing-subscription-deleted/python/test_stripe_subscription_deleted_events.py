from stripe_subscription_deleted_events import verdict, subscribed_events


def test_an_account_without_subscriptions_is_not_a_finding():
    state, _ = verdict([], 0, 0)
    assert state == "not-billing"


def test_missing_with_cancellations_behind_it_is_a_backlog():
    state, detail = verdict(["invoice.paid"], 214, 900)
    assert state == "over-entitled"
    assert "214" in detail


def test_missing_with_nothing_ended_yet_is_only_a_gap():
    state, detail = verdict(["invoice.paid"], 0, 40)
    assert state == "unsubscribed"
    assert "gap rather than a backlog" in detail


def test_deleted_without_updated_is_partial():
    state, detail = verdict(["customer.subscription.deleted"], 5, 40)
    assert state == "partial"
    assert "customer.subscription.updated" in detail


def test_both_events_subscribed_is_covered():
    state, _ = verdict(["customer.subscription.deleted",
                        "customer.subscription.updated"], 5, 40)
    assert state == "covered"


def test_a_wildcard_covers_it_and_is_still_called_out():
    state, _ = verdict(["*"], 5, 40)
    assert state == "wildcard"


def test_the_union_flattens_every_endpoint():
    union = subscribed_events([{"enabled_events": ["invoice.paid"]},
                               {"enabled_events": ["customer.subscription.deleted"]},
                               {}])
    assert union == {"invoice.paid", "customer.subscription.deleted"}
