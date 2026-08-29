"""Report Stripe invoices where dunning has stopped and no attempt is scheduled.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Invoices. The repair is printed, never performed, because paying an
invoice moves money and marking one uncollectible writes off revenue.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dunning_exhausted")

API = "https://api.stripe.com/v1"

# The default Smart Retries schedule is eight attempts over two weeks. Four is a
# deliberately conservative floor: past it, a sequence that has stopped has
# stopped for a reason rather than by coincidence.
EXHAUSTED_ATTEMPTS = 4


def verdict(attempt_count, next_attempt_in_days, amount_remaining):
    """Classify one automatically collected invoice. Pure, so the rules can be tested.

    `next_attempt_in_days` is the time until `next_payment_attempt`, and None when
    that field is null, which is Stripe saying it will not try again. Returns
    (state, detail).
    """
    if not amount_remaining or amount_remaining <= 0:
        return ("nothing_due", "open with amount_remaining 0: no money outstanding")
    if next_attempt_in_days is None:
        if attempt_count >= EXHAUSTED_ATTEMPTS:
            return ("exhausted",
                    "%d attempt(s) and next_payment_attempt is null: dunning is "
                    "over and nothing will collect this" % attempt_count)
        if attempt_count:
            return ("stopped_early",
                    "only %d attempt(s) and nothing scheduled: Smart Retries is "
                    "off, or an end-of-dunning action already ran" % attempt_count)
        return ("never_attempted",
                "0 attempts and nothing scheduled: this invoice was never charged "
                "at all, which is an integration problem rather than a decline")
    if attempt_count >= EXHAUSTED_ATTEMPTS:
        return ("stalled",
                "%d attempt(s) with another in %.1f day(s): on a hard decline the "
                "count keeps rising but nothing collects until a new payment "
                "method is attached" % (attempt_count, next_attempt_in_days))
    return ("retrying",
            "%d attempt(s), next in %.1f day(s): dunning is still running"
            % (attempt_count, next_attempt_in_days))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def open_invoices(session, limit):
    """Page open invoices that Stripe is supposed to be charging by itself."""
    out = []
    params = {"status": "open", "collection_method": "charge_automatically",
              "limit": 100}
    while True:
        page = get(session, "/invoices", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--top", type=int, default=20,
                    help="how many individual invoices to print")
    ap.add_argument("--max-invoices", type=int, default=2000,
                    help="stop paginating after this many open invoices")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    rows = []
    for inv in open_invoices(s, args.max_invoices):
        nxt = inv.get("next_payment_attempt")
        remaining = inv.get("amount_remaining") or 0
        rows.append((
            inv.get("id", "<no id>"),
            inv.get("subscription") or "<no subscription>",
            verdict(inv.get("attempt_count") or 0,
                    None if nxt is None else (nxt - now) / 86400.0,
                    remaining),
            remaining,
            (inv.get("currency") or "").upper(),
        ))

    stopped = [r for r in rows if r[2][0] in
               ("exhausted", "stopped_early", "never_attempted", "stalled")]
    if not stopped:
        log.info("%-15s 0 invoice(s) with dunning stopped", "clear")
        return 0

    stopped.sort(key=lambda r: r[3], reverse=True)
    lost = sum(r[3] for r in stopped)
    log.warning("%-15s %d invoice(s) nothing is collecting, worth %d in minor units",
                "stopped", len(stopped), lost)
    for inv_id, sub, (state, detail), amount, currency in stopped[:args.top]:
        log.warning("  %-15s %s  %d %s  %s", state, inv_id, amount, currency, detail)
        if state in ("exhausted", "stalled"):
            log.warning("      collect a card, then set it on the subscription "
                        "before paying: POST %s/subscriptions/%s "
                        "default_payment_method=<pm>", API, sub)
            log.warning("      then POST %s/invoices/%s/pay", API, inv_id)
    if len(stopped) > args.top:
        log.warning("  ... and %d more", len(stopped) - args.top)
    log.warning("  check the schedule itself: Dashboard, Billing, Revenue "
                "recovery, Retries, and set an end-of-dunning action")
    return 1


if __name__ == "__main__":
    sys.exit(main())
