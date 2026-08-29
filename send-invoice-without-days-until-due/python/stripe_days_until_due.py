"""Report Stripe send_invoice subscriptions that write invoices with no due date.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with read
access to Subscriptions and Invoices. The repair is printed, never performed,
because changing payment terms changes what a customer owes and when.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_days_until_due")

API = "https://api.stripe.com/v1"

# Roughly how many days each recurring interval is worth. Used only to compare
# payment terms against the billing period, so month lengths do not matter.
INTERVAL_DAYS = {"day": 1, "week": 7, "month": 30, "year": 365}


def verdict(collection_method, days_until_due, interval_days, undated_open_invoices):
    """Classify one subscription. Pure, so the rules can be tested without a network.

    `days_until_due` is the raw field: None when absent, and 0 is a real value
    meaning due on receipt. `interval_days` is the billing period in days, or
    None if it could not be read. `undated_open_invoices` is how many open
    invoices this subscription already has with a null due_date.

    Returns (state, detail).
    """
    if collection_method != "send_invoice":
        return ("automatic",
                "collection_method is %r: Stripe charges the payment method on "
                "file, so days_until_due does not apply" % (collection_method,))
    if days_until_due is None:
        if undated_open_invoices:
            return ("undated",
                    "days_until_due is null and %d open invoice(s) already have "
                    "due_date null: nothing can mark them overdue"
                    % undated_open_invoices)
        return ("unanchored",
                "days_until_due is null, so every invoice this subscription "
                "writes will have due_date null and can never age")
    if days_until_due == 0:
        return ("on-receipt",
                "net 0, due on receipt: a real term, not a missing one")
    if interval_days and days_until_due >= interval_days:
        return ("overlapping",
                "net %d on a %d day billing period: the next invoice is issued "
                "before this one is due" % (days_until_due, interval_days))
    return ("dated",
            "net %d; due_date is set and the past due machinery has something "
            "to measure from" % days_until_due)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Page a list endpoint until it runs out or the cap is reached."""
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


def interval_days(sub):
    """Billing period length in days, or None when the price cannot be read."""
    items = (sub.get("items") or {}).get("data") or []
    if not items:
        return None
    recurring = (items[0].get("price") or {}).get("recurring") or {}
    unit = INTERVAL_DAYS.get(recurring.get("interval"))
    if not unit:
        return None
    return unit * (recurring.get("interval_count") or 1)


def undated_open_invoices(session, limit):
    """Count open send_invoice invoices with a null due_date, per subscription.

    The list endpoint has no server-side filter for due_date, so the comparison
    is client side over invoices Stripe has already narrowed by status and
    collection method.
    """
    counts = {}
    for inv in page_all(session, "/invoices", limit,
                        status="open", collection_method="send_invoice"):
        if inv.get("due_date") is None:
            sub = inv.get("subscription")
            if isinstance(sub, dict):
                sub = sub.get("id")
            counts[sub] = counts.get(sub, 0) + 1
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--top", type=int, default=20,
                    help="how many individual subscriptions to print")
    ap.add_argument("--max-rows", type=int, default=2000,
                    help="stop paginating each list after this many objects")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    undated = undated_open_invoices(s, args.max_rows)
    subs = page_all(s, "/subscriptions", args.max_rows,
                    collection_method="send_invoice", status="all")
    if not subs:
        log.info("no send_invoice subscriptions for this key's mode")
        return 0

    rows = []
    for sub in subs:
        state, detail = verdict(sub.get("collection_method"),
                                sub.get("days_until_due"),
                                interval_days(sub),
                                undated.get(sub.get("id"), 0))
        rows.append((sub.get("id", "<no id>"), state, detail))

    bad = [r for r in rows if r[1] in ("undated", "unanchored", "overlapping")]
    if not bad:
        log.info("%-11s 0 of %d send_invoice subscription(s) without terms",
                 "clear", len(rows))
        return 0

    log.warning("%-11s %d of %d send_invoice subscription(s) need terms",
                "unterm", len(bad), len(rows))
    for sub_id, state, detail in bad[:args.top]:
        log.warning("  %-11s %s  %s", state, sub_id, detail)
        log.warning("      repair: POST %s/subscriptions/%s  days_until_due=30",
                    API, sub_id)
    if len(bad) > args.top:
        log.warning("  ... and %d more", len(bad) - args.top)
    log.warning("  then Dashboard > Settings > Billing > Invoices: enable the "
                "reminder emails and set the past due subscription action")
    log.warning("  invoices already finalized keep their null due_date; those "
                "need a resend or a write off, one at a time")
    return 1


if __name__ == "__main__":
    sys.exit(main())
