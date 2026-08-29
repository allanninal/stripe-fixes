"""Report Stripe Customers that share an email address.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Customers, Subscriptions and PaymentMethods. The merge is printed,
never performed, because deleting a customer cancels its subscriptions and this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_duplicate_customers")

API = "https://api.stripe.com/v1"


def normalise(email):
    """Lowercase and trim an address for grouping. Pure.

    Stripe's own email filter is exact and case-sensitive, so a user who
    capitalised once and did not the next time has two records that no exact
    lookup will ever put beside each other. Grouping has to normalise even
    though the confirming API call cannot.
    """
    if not email:
        return None
    return str(email).strip().lower() or None


def verdict(records):
    """Classify one group of customers sharing an address. Pure.

    Each record is {"id": str, "has_card": bool, "has_subscription": bool},
    filled in by the caller. Returns (state, detail).
    """
    n = len(records)
    if n <= 1:
        return ("unique", "one customer for this address")

    subs = [r for r in records if r.get("has_subscription")]
    holders = [r for r in records
               if r.get("has_card") or r.get("has_subscription")]

    if len(subs) > 1:
        return ("split_billing",
                "%d records, %d with a subscription. They renew independently, "
                "so cancelling one leaves the other charging." % (n, len(subs)))
    if len(holders) > 1:
        return ("split_methods",
                "%d records, %d holding a card or a subscription. Support will "
                "answer from whichever one they find first." % (n, len(holders)))
    if holders:
        return ("shells",
                "%d records, one holding everything. The other %d are empty."
                % (n, n - 1))
    return ("empty",
            "%d records, none holding a card or a subscription. Untidy, not "
            "urgent." % n)


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def group_by_email(session, limit):
    """Return {normalised email: [customer ids]} plus the number read."""
    groups = {}
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/customers", params)
        data = page.get("data", [])
        for c in data:
            seen += 1
            key = normalise(c.get("email"))
            if key is None:
                continue  # no email is a different problem
            groups.setdefault(key, []).append(c["id"])
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return groups, seen


def enrich(session, customer_id):
    """One record for verdict(), costing two small GETs."""
    cards = get(session, "/payment_methods",
                {"customer": customer_id, "type": "card", "limit": 1})
    subs = get(session, "/subscriptions",
               {"customer": customer_id, "status": "all", "limit": 1})
    return {"id": customer_id,
            "has_card": bool(cards.get("data")),
            "has_subscription": bool(subs.get("data"))}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-customers", type=int, default=10000,
                    help="stop paginating after this many customers")
    ap.add_argument("--max-groups", type=int, default=50,
                    help="how many duplicate groups to enrich and report")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    groups, seen = group_by_email(s, args.max_customers)
    dupes = {e: ids for e, ids in groups.items() if len(ids) > 1}
    log.info("%d customer(s), %d address(es) with more than one record",
             seen, len(dupes))
    if not dupes:
        return 0

    # Worst first: the ones with the most records are the ones support is
    # already losing time to.
    ordered = sorted(dupes.items(), key=lambda kv: -len(kv[1]))[:args.max_groups]
    bad = 0
    for email, ids in ordered:
        records = [enrich(s, cid) for cid in ids]
        state, detail = verdict(records)
        log.warning("%-14s %s  %s", state, email, detail)
        log.warning("  records: %s", ", ".join(r["id"] for r in records))
        if state in ("split_billing", "split_methods"):
            bad += 1
            keeper = records[0]["id"]
            log.warning("  merge: POST %s/payment_methods/<pm>/attach "
                        "-d customer=%s, move the subscriptions, then "
                        "DELETE %s/customers/<dupe>", API, keeper, API)
            log.warning("  deleting a customer cancels its subscriptions, so "
                        "empty the record before you delete it")
    log.warning("  prevent: GET %s/customers?email=<address>&limit=1 before "
                "creating, and store the cus_ id on your own user row", API)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
