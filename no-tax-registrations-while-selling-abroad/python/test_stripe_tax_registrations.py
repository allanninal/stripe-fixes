from stripe_tax_registrations import verdict


REGISTERED = {"DE", "GB", "US-CA"}
EXPIRED = {"FR"}


def test_a_registered_country_is_covered():
    state, detail = verdict("DE", REGISTERED, EXPIRED, 4200000, 214)
    assert state == "covered"
    assert "214 paid invoice(s)" in detail


def test_an_expired_registration_is_its_own_finding():
    # Identical invoices to the never-registered case, different phone call.
    state, detail = verdict("FR", REGISTERED, EXPIRED, 50000, 9)
    assert state == "lapsed"
    assert "expired" in detail


def test_small_revenue_in_a_new_country_is_still_reported():
    assert verdict("NO", REGISTERED, EXPIRED, 12000, 3)[0] == "unregistered"


def test_large_revenue_escalates_to_exposed():
    assert verdict("AU", REGISTERED, EXPIRED, 999999, 40)[0] == "unregistered"
    assert verdict("AU", REGISTERED, EXPIRED, 1000000, 40)[0] == "exposed"


def test_one_us_state_does_not_cover_another():
    assert verdict("US-CA", REGISTERED, EXPIRED, 800000, 60)[0] == "covered"
    assert verdict("US-NY", REGISTERED, EXPIRED, 800000, 60)[0] == "unregistered"
