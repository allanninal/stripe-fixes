from stripe_idempotency_key_reuse import key_shape, verdict

UUID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff"


def test_two_requests_inside_the_window_is_the_409():
    state, detail = verdict(UUID, 2, 30)
    assert state == "concurrent"
    assert "409" in detail


def test_two_requests_a_day_apart_is_a_duplicate_not_a_conflict():
    # Past the pruning window Stripe has forgotten the key, so the second
    # request is genuinely new and no error is returned at all.
    state, detail = verdict(UUID, 2, 108000)
    assert state == "pruned"
    assert "86400" in detail


def test_a_key_built_from_a_customer_id_is_flagged_before_it_collides():
    assert key_shape("cus_Nc1mzuAyRlKmGT")[0] == "object-id"
    state, _ = verdict("cus_Nc1mzuAyRlKmGT", 1, 0)
    assert state == "derived"


def test_an_email_address_is_never_an_acceptable_key():
    shape, described = key_shape("ada@example.com")
    assert shape == "personal"
    assert "email" in described
    assert verdict("ada@example.com", 1, 0)[0] == "derived"


def test_a_uuid_on_one_request_is_clean():
    assert key_shape(UUID)[0] == "uuid"
    assert verdict(UUID, 1, 0)[0] == "unique"
    assert key_shape("2026-08-30")[0] == "date"
    assert key_shape("41231")[0] == "integer"
