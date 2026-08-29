from stripe_dead_event_types import verdict

FIRED = {"payment_intent.succeeded", "invoice.paid", "customer.source.expiring"}


def test_a_removed_type_is_rejected():
    state, detail = verdict("invoiceitem.updated", FIRED)
    assert state == "rejected"
    assert "update" in detail


def test_a_silent_sources_type_is_dead():
    state, _ = verdict("source.chargeable", FIRED)
    assert state == "dead"


def test_a_sources_type_that_still_fires_is_not_dead():
    # Still firing means something still creates Sources. That is a migration
    # finding, not a subscription to delete.
    state, _ = verdict("customer.source.expiring", FIRED)
    assert state == "legacy"


def test_silence_on_a_current_type_is_not_decay():
    # Zero disputes in 30 days is a good month. Calling this dead would have the
    # script recommend unsubscribing from disputes.
    state, detail = verdict("charge.dispute.created", FIRED)
    assert state == "quiet"
    assert "low volume" in detail


def test_a_wildcard_has_nothing_to_diff():
    assert verdict("*", FIRED)[0] == "wildcard"
