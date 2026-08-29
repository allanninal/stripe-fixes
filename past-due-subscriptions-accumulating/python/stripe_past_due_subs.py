"""Report Stripe subscriptions parked in past_due while access continues.

Read only. GET requests only, no writes: give this a RESTRICTED key with read
access to Subscriptions and Invoices. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_past_due_subs")

API = "https://api.stripe.com/v1"

# No retry schedule Stripe offers runs longer than a month, so an invoice older
# than this is not waiting on anything: the subscription has simply been left.
DUNNING_DAYS = 30


def verdict(sub, now, dunning_days=DUNNING_DAYS):
    """Classify one past_due subscription from its latest invoice.

    Pure, so the difference between live dunning and a parked subscription can be
    tested without a network. Needs the invoice expanded; an unexpanded id is
    reported as unknown rather than guessed at.
    """
    invoice = sub.get("latest_invoice")
    if not isinstance(invoice, dict):
        return ("unknown",
                "latest_invoice was not expanded; re-run with "
                "expand[]=data.latest_invoice")
    created = invoice.get("created")
    if not isinstance(created, (int, float)):
        return ("unknown", "latest_invoice has no created timestamp to age")
    attempts = invoice.get("attempt_count") or 0
    days = (now - created) / 86400.0
    if attempts == 0:
        return ("never-attempted",
                "invoice %.0f day(s) old with no payment attempt at all: usually no "
                "payment method resolves, so retries never run" % days)
    if days > dunning_days:
        return ("parked",
                "%d attempt(s), invoice %.0f day(s) old: past any retry schedule, so "
                "nothing further will happen to this on its own" % (attempts, days))
    return ("dunning",
            "%d attempt(s) over %.0f day(s): retries are still running and this may "
            "recover" % (attempts, days))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_subscriptions(session, status, limit, expand=None):
    """Walk one status page by page. Read only; every call here is a GET."""
    out = []
    params = {"status": status, "limit": 100}
    if expand:
        params["expand[]"] = expand
    while True:
        page = get(session, "/subscriptions", **params)
        out.extend(page.get("data", []))
        if not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = page["data"][-1]["id"]
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dunning-days", type=int, default=DUNNING_DAYS,
                    help="invoice age past which retries are certainly over")
    ap.add_argument("--max", type=int, default=1000,
                    help="stop after this many subscriptions per status")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    past_due = page_subscriptions(s, "past_due", args.max, expand="data.latest_invoice")
    active = page_subscriptions(s, "active", args.max)
    if not past_due:
        log.info("no past_due subscriptions for this key's mode")
        return 0

    now = time.time()
    counts = {}
    for sub in past_due:
        state, detail = verdict(sub, now, args.dunning_days)
        counts[state] = counts.get(state, 0) + 1
        log.warning("%-15s %s  %s", state, sub.get("id", "?"), detail)
        if state == "parked":
            log.warning("  repair: close it out with POST %s/subscriptions/%s "
                        "-d cancel_at_period_end=true, or DELETE %s/subscriptions/%s "
                        "to end it now", API, sub.get("id"), API, sub.get("id"))
        elif state == "never-attempted":
            log.warning("  repair: attach a payment method first, then pay invoice %s",
                        (sub.get("latest_invoice") or {}).get("id", "in_..."))

    ratio = 100.0 * len(past_due) / max(1, len(past_due) + len(active))
    log.info("%d past_due against %d active (%.1f%%), %d parked, %d never attempted",
             len(past_due), len(active), ratio, counts.get("parked", 0),
             counts.get("never-attempted", 0))
    log.warning("entitlement check: gate on status in (active, trialing), not on "
                "status != canceled")
    log.warning("billing setting: Billing > Revenue recovery > Retries, set the "
                "post-retry action to cancel or mark unpaid")
    return 1


if __name__ == "__main__":
    sys.exit(main())
