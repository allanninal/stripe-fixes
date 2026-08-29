"""Report countries you invoice into with no active Stripe Tax registration.

Read only. Three GETs, no writes: give this a RESTRICTED key with read access to
Tax and Invoices. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_tax_registrations")

API = "https://api.stripe.com/v1"

# Roughly where Stripe's own threshold monitoring starts emailing, in minor units
# of the invoice currency. Currencies are not converted: this is a triage rank,
# not an accounting figure, and it is deliberately a constant you can move.
WATCH_MINOR = 1000000


def verdict(country, registered, expired, revenue_minor, invoice_count):
    """Classify one billed country. Pure, so the rules can be tested offline.

    `registered` and `expired` are sets of country codes from
    /v1/tax/registrations. Returns (state, detail).
    """
    where = "%d paid invoice(s), %d minor unit(s) billed" % (invoice_count,
                                                             revenue_minor)
    if country in registered:
        return ("covered", "registered, %s" % where)
    if country in expired:
        return ("lapsed",
                "a registration existed and has expired, so collection stopped on "
                "a known date. %s since." % where)
    if revenue_minor >= WATCH_MINOR:
        return ("exposed",
                "no registration and %s. This is the size at which a threshold is "
                "the likely explanation for the letter." % where)
    return ("unregistered", "no registration, %s" % where)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def paginate(session, path, **params):
    params = dict(params, limit=params.get("limit", 100))
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for row in data:
            yield row
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def registration_countries(session, status):
    """Country codes with a registration in the given status.

    US registrations are per state, so a US row is recorded as US-CA rather than
    US: one state registration does not authorise collection in the other 49.
    """
    out = set()
    for reg in paginate(session, "/tax/registrations", status=status):
        country = (reg.get("country") or "").upper()
        if not country:
            continue
        state = ((reg.get("country_options") or {}).get("us") or {}).get("state")
        out.add("%s-%s" % (country, state.upper()) if country == "US" and state
                else country)
    return out


def billed_countries(session, since):
    """Tally paid invoices by the customer's country. Returns {code: (count, minor)}."""
    tally = {}
    for inv in paginate(session, "/invoices", status="paid",
                        **{"created[gte]": since}):
        addr = inv.get("customer_address") or {}
        country = (addr.get("country") or "").upper()
        if not country:
            continue
        key = country
        if country == "US" and addr.get("state"):
            key = "US-%s" % addr["state"].upper()
        count, amount = tally.get(key, (0, 0))
        tally[key] = (count + 1, amount + (inv.get("amount_paid") or 0))
    return tally


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=365,
                    help="how far back to read paid invoices")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    registered = registration_countries(s, "active")
    expired = registration_countries(s, "expired")
    since = int(time.time()) - args.days * 86400
    tally = billed_countries(s, since)

    if not tally:
        log.info("no paid invoices with a customer country in the last %d days",
                 args.days)
        return 0

    findings = 0
    for country, (count, amount) in sorted(tally.items(), key=lambda kv: -kv[1][1]):
        state, detail = verdict(country, registered, expired, amount, count)
        line = "%-12s %-6s %s" % (state, country, detail)
        if state == "covered":
            log.info(line)
            continue
        findings += 1
        log.warning(line)

    if findings:
        log.warning("register with each authority, then record it so calculation "
                    "starts returning a number rather than a correct zero")
        log.warning("  GET %s/tax/registrations?status=active   "
                    "(the list this check compares against)", API)
        log.warning("  Dashboard: Tax > Locations shows threshold progress per "
                    "jurisdiction, which this API cannot")
    log.info("%d billed country/state(s), %d without an active registration",
             len(tally), findings)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
