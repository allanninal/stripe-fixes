"""Report Stripe subscriptions billing without automatic_tax while invoicing abroad.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with read
access to Subscriptions and Invoices. The repair is printed, never performed.

This is a configuration check, not tax advice. It tells you where you are
invoicing with tax calculation switched off; whether that is a liability is a
question for an accountant.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_automatic_tax_off")

API = "https://api.stripe.com/v1"

# Jurisdictions where a remote seller most commonly acquires a collection
# obligation. Deliberately not exhaustive: the point is to raise the question for
# the obvious cases, not to decide the answer.
REGISTRATION_COUNTRIES = frozenset("""
AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE
GB NO CH AU NZ CA JP SG AE ZA IN
""".split())


def verdict(off_count, total_count, countries):
    """Classify the account. Pure, so the rules can be tested without a network.

    `off_count` is active subscriptions with automatic_tax.enabled false,
    `total_count` is all active subscriptions, and `countries` is the distinct set
    of customer_address.country values seen on untaxed paid invoices. Returns
    (state, detail).
    """
    if not total_count:
        return ("empty", "no active subscriptions to check")
    if not off_count:
        return ("on", "automatic_tax is enabled on all %d active subscription(s)"
                % total_count)
    seen = sorted({(c or "").upper() for c in (countries or []) if c})
    if not seen:
        return ("unknown",
                "%d of %d active subscription(s) have automatic_tax off, and no "
                "untaxed invoice carries customer_address.country: the exposure "
                "cannot be judged, and Stripe could not compute tax either"
                % (off_count, total_count))
    exposed = [c for c in seen if c in REGISTRATION_COUNTRIES]
    if exposed:
        where = ", ".join(exposed)
        if off_count >= total_count:
            return ("exposed",
                    "automatic_tax is off on all %d active subscription(s), and "
                    "untaxed invoices went to %s" % (total_count, where))
        return ("partial",
                "%d of %d active subscription(s) have automatic_tax off: the "
                "create path was fixed and the older ones never backfilled. "
                "Untaxed invoices went to %s" % (off_count, total_count, where))
    if len(seen) > 1:
        return ("multi_country",
                "%d of %d off, and untaxed invoices span %d countries (%s)"
                % (off_count, total_count, len(seen), ", ".join(seen)))
    return ("domestic",
            "%d of %d off, but every untaxed invoice is billed to %s. Check that "
            "against your registrations rather than assuming it is wrong"
            % (off_count, total_count, seen[0]))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    out = []
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=2000,
                    help="stop paginating active subscriptions after this many")
    ap.add_argument("--max-invoices", type=int, default=1000,
                    help="how many recent paid invoices to sample for countries")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = page_all(s, "/subscriptions", args.max_subscriptions, status="active")
    total = len(subs)
    off = [x for x in subs if not (x.get("automatic_tax") or {}).get("enabled")]

    countries = []
    for inv in page_all(s, "/invoices", args.max_invoices, status="paid"):
        if (inv.get("automatic_tax") or {}).get("enabled"):
            continue
        addr = inv.get("customer_address") or {}
        if addr.get("country"):
            countries.append(addr["country"])

    state, detail = verdict(len(off), total, countries)
    line = "%-13s %s" % (state, detail)
    if state in ("on", "empty"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  register first: Stripe calculates zero where you have no active "
                "registration, which looks identical to tax being off")
    log.warning("  then set it on every create path: POST %s/subscriptions and "
                "POST %s/checkout/sessions both take automatic_tax[enabled]=true",
                API, API)
    log.warning("  then backfill: POST %s/subscriptions/<sub> "
                "automatic_tax[enabled]=true", API)
    for sub in off[:10]:
        log.warning("      %s", sub.get("id", "<no id>"))
    if len(off) > 10:
        log.warning("      ... and %d more", len(off) - 10)
    return 1


if __name__ == "__main__":
    sys.exit(main())
