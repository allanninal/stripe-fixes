from stripe_payment_failure_events import verdict


def test_success_subscribed_without_the_failure_is_one_sided():
    state, detail = verdict(["payment_intent.succeeded"], False, 0)
    assert state == "one-sided"
    assert "payment_intent.payment_failed" in detail


def test_active_subscriptions_with_failures_already_seen_is_an_incident():
    # Same missing subscription as the gap below; the failures make it live.
    state, detail = verdict(["payment_intent.succeeded",
                             "payment_intent.payment_failed"], True, 9)
    assert state == "blind"
    assert "9 invoice" in detail


def test_no_subscriptions_means_the_invoice_event_is_not_required():
    state, _ = verdict(["payment_intent.succeeded",
                        "payment_intent.payment_failed"], False, 0)
    assert state == "covered"


def test_both_surfaces_missing_is_reported_as_one_finding():
    state, _ = verdict(["payment_intent.succeeded", "invoice.paid"], True, 0)
    assert state == "exposed"


def test_an_account_with_no_payment_events_at_all():
    state, _ = verdict(["customer.created"], False, 0)
    assert state == "no-payment-events"


def test_a_wildcard_covers_both_surfaces():
    state, _ = verdict(["*"], True, 40)
    assert state == "wildcard"
