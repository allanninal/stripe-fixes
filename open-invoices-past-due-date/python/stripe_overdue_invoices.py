"""Report open Stripe invoices that are past their due_date with nothing chasing them.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Invoices. The repair is printed, never performed, because re-sending an
invoice emails a customer and marking one uncollectible writes off revenue.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_overdue_invoices")

API = "https://api.stripe.com/v1"

ACTION_DAYS = 30      # earliest past-due subscription action Stripe offers
REMINDER_END_DAYS = 60  # past this, no built-in reminder will ever be sent


def verdict(days_overdue, amount_remaining):
    """Classify one open invoice. Pure, so the boundaries can be tested without a network.

    `days_overdue` is negative while the invoice is still within terms and None
    when it has no due_date at all. Returns (state, detail).
    """
    if not amount_remaining or amount_remaining <= 0:
        return ("nothing_due", "open with amount_remaining 0: no money outstanding")
    if days_overdue is None:
        return ("undated",
                "open with no due_date: it can never be overdue, so no reminder "
                "will ever fire for it")
    if days_overdue < 0:
        return ("current", "due in %.1f day(s)" % -days_overdue)
    if days_overdue < ACTION_DAYS:
        return ("overdue",
                "%.0f day(s) past due; still inside the reminder window" % days_overdue)
    if days_overdue < REMINDER_END_DAYS:
        return ("stale",
                "%.0f day(s) past due; past the point where a subscription action "
                "would have fired had one been configured" % days_overdue)
    return ("abandoned",
            "%.0f day(s) past due; beyond every built-in reminder, so nothing "
            "automated will chase this one again" % days_overdue)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def open_invoices(session, limit):
    """Page open, manually collected invoices.

    There is no server-side filter for due_date on this endpoint, so the whole set
    comes back and the comparison happens here.
    """
    out = []
    params = {"status": "open", "collection_method": "send_invoice", "limit": 100}
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
        due = inv.get("due_date")
        remaining = inv.get("amount_remaining") or 0
        rows.append((
            inv.get("id", "<no id>"),
            verdict(None if due is None else (now - due) / 86400.0, remaining),
            remaining,
            (inv.get("currency") or "").upper(),
        ))

    late = [r for r in rows if r[1][0] in ("overdue", "stale", "abandoned", "undated")]
    if not late:
        log.info("%-12s 0 open invoice(s) past due_date", "clear")
        return 0

    # Biggest balance first: the oldest invoice is rarely the one worth a call.
    late.sort(key=lambda r: r[2], reverse=True)
    outstanding = sum(r[2] for r in late)
    log.warning("%-12s %d unchased invoice(s) worth %d in minor units",
                "receivable", len(late), outstanding)
    for inv_id, (state, detail), amount, currency in late[:args.top]:
        log.warning("  %-12s %s  %d %s  %s", state, inv_id, amount, currency, detail)
    if len(late) > args.top:
        log.warning("  ... and %d more", len(late) - args.top)
    log.warning("  turn the follow-up on first: Dashboard, Settings, Billing, "
                "Invoices, then enable reminder emails and the past-due "
                "subscription action")
    log.warning("  then per invoice: POST %s/invoices/<id>/send to re-send, or "
                "mark_uncollectible on the ones nobody will pay", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
