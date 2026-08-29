"""Report Stripe customers whose address cannot satisfy Tax, AVS or SCA.

Read only. Paginated GETs and one search, no writes: give this a RESTRICTED key
with read access to Customers, Subscriptions and Invoices. The repair is printed,
never performed, because this script holds a credential to a live payments
account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_customer_address")

API = "https://api.stripe.com/v1"

WIDESPREAD = 0.25   # share of incomplete addresses that means the collection path is wrong


def address_state(customer):
    """Classify one customer's address. Pure, so it can be tested without a network.

    Returns one of "missing", "no_country", "no_postal_code" or "complete".

    Stripe returns `address` either as null or as an object whose fields are
    individually null. An object with nothing in it is an absent address, not a
    partial one, and collapsing the two hides the customers who look filled in on
    the Dashboard but resolve to no location at all.
    """
    addr = customer.get("address")
    if not isinstance(addr, dict):
        return "missing"
    if not any(v for v in addr.values()):
        return "missing"
    if not addr.get("country"):
        return "no_country"
    if not addr.get("postal_code"):
        return "no_postal_code"
    return "complete"


def verdict(total, incomplete, subscribed_incomplete, tax_failures):
    """Roll the counts up into one state. Pure.

    Ordered deliberately: an invoice that has already refused to finalize outranks
    any percentage, and a subscribed customer outranks a free-tier one, because
    only the subscribed ones have a finalization due every cycle.
    """
    if not total:
        return ("unknown", "no customers read; check the key and the mode it belongs to")
    if tax_failures:
        return ("failing",
                "%d invoice(s) already refused to finalize with "
                "customer_tax_location_invalid. This is not a risk, it is unsent "
                "revenue." % tax_failures)
    if subscribed_incomplete:
        return ("billing",
                "%d subscribed customer(s) have an incomplete address. Each renewal "
                "is a finalization that can fail." % subscribed_incomplete)
    share = incomplete / float(total)
    if share >= WIDESPREAD:
        return ("widespread",
                "%d of %d customer(s), %.0f%%, have an incomplete address. At that "
                "share the collection path is wrong, not the data." % (
                    incomplete, total, share * 100))
    if incomplete:
        return ("residue",
                "%d of %d customer(s) have an incomplete address. Backfill them and "
                "close the collection hole." % (incomplete, total))
    return ("clear", "%d customer(s), 0 with an incomplete address" % total)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Yield every object from a paginated list endpoint, up to `limit`."""
    seen = 0
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def tax_failure_count(session):
    """Count invoices that failed to finalize on the customer's location.

    Search is a separate index and is not enabled on every account, so a failure
    here is reported and treated as no evidence rather than as zero evidence.
    """
    try:
        page = get(session, "/invoices/search",
                   query="last_finalization_error_code:'customer_tax_location_invalid'",
                   limit=100)
    except requests.HTTPError as exc:
        log.info("invoice search unavailable (%s); skipping the confirmation step", exc)
        return 0
    return len(page.get("data", []))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-customers", type=int, default=5000,
                    help="stop paginating customers after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    buckets = {"missing": 0, "no_country": 0, "no_postal_code": 0, "complete": 0}
    examples = {}
    total = 0
    for cus in page_all(s, "/customers", args.max_customers):
        state = address_state(cus)
        buckets[state] += 1
        total += 1
        if state != "complete":
            examples.setdefault(state, cus["id"])

    subscribed_incomplete = 0
    for sub in page_all(s, "/subscriptions", 1000, status="active",
                        **{"expand[]": "data.customer"}):
        cus = sub.get("customer")
        if isinstance(cus, dict) and address_state(cus) != "complete":
            subscribed_incomplete += 1

    incomplete = total - buckets["complete"]
    state, detail = verdict(total, incomplete, subscribed_incomplete,
                            tax_failure_count(s))

    line = "%-11s %s" % (state, detail)
    if state in ("clear", "unknown"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  %d absent, %d without a country, %d without a postal code",
                buckets["missing"], buckets["no_country"], buckets["no_postal_code"])
    for bucket, cus_id in sorted(examples.items()):
        log.warning("  example %-14s %s", bucket, cus_id)
    log.warning("  repair one customer:")
    log.warning("  POST %s/customers/{id} -d \"address[line1]=...\" "
                "-d \"address[city]=...\" -d \"address[postal_code]=...\" "
                "-d \"address[country]=US\"", API)
    log.warning("  stop creating more: set billing_address_collection=required on "
                "Checkout Sessions, or collect billing details in the Payment Element")
    return 1


if __name__ == "__main__":
    sys.exit(main())
