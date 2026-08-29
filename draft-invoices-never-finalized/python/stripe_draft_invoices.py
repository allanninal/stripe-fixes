"""Report Stripe draft invoices that will never finalize on their own.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Invoices. The repair is printed, never performed, because finalizing an
invoice sends a bill to a customer and deleting one destroys it.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_draft_invoices")

API = "https://api.stripe.com/v1"

# Stripe finalizes about an hour after invoice.created is acknowledged, and
# defers up to 72 hours while endpoints are failing. Anything still a draft well
# past that is not waiting for the workflow, it is outside it.
STALE_DAYS = 30


def verdict(age_days, auto_advance, finalizes_in_days, amount_due):
    """Classify one draft invoice. Pure, so the rules can be tested without a network.

    `age_days` is how long the invoice has been a draft. `finalizes_in_days` is
    the time until `automatically_finalizes_at`, negative if that moment has
    already passed, and None when the field is null. Returns (state, detail).
    """
    if age_days < STALE_DAYS:
        return ("fresh",
                "draft for %.1f day(s); still inside the window where Stripe "
                "finalizes on its own" % age_days)
    if not amount_due:
        return ("empty",
                "draft for %.0f day(s) with amount_due 0: clutter rather than "
                "money, and safe to delete" % age_days)
    if not auto_advance:
        return ("stranded",
                "auto_advance is false after %.0f day(s): no finalization is "
                "scheduled and none will be" % age_days)
    if finalizes_in_days is None:
        return ("unscheduled",
                "auto_advance is true after %.0f day(s) but "
                "automatically_finalizes_at is null: nothing is queued" % age_days)
    if finalizes_in_days < 0:
        return ("blocked",
                "the scheduled finalization passed %.1f day(s) ago and this is "
                "still a draft: read last_finalization_error"
                % -finalizes_in_days)
    return ("scheduled",
            "finalizes in %.1f day(s); leave it alone" % finalizes_in_days)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def drafts(session, older_than_days, limit):
    """Page draft invoices created before the cutoff. Newest first, as Stripe sends them."""
    cutoff = int(time.time() - older_than_days * 86400)
    out = []
    params = {"status": "draft", "limit": 100, "created[lt]": cutoff}
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
    ap.add_argument("--older-than", type=float, default=STALE_DAYS,
                    help="only look at drafts created this many days ago or more")
    ap.add_argument("--top", type=int, default=20,
                    help="how many individual invoices to print")
    ap.add_argument("--max-invoices", type=int, default=2000,
                    help="stop paginating after this many drafts")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    rows = []
    for inv in drafts(s, args.older_than, args.max_invoices):
        created = inv.get("created") or now
        finalizes_at = inv.get("automatically_finalizes_at")
        rows.append((
            inv.get("id", "<no id>"),
            verdict((now - created) / 86400.0,
                    bool(inv.get("auto_advance")),
                    None if finalizes_at is None else (finalizes_at - now) / 86400.0,
                    inv.get("amount_due") or 0),
            inv.get("amount_due") or 0,
            (inv.get("currency") or "").upper(),
        ))

    stuck = [r for r in rows
             if r[1][0] in ("stranded", "unscheduled", "blocked")]
    if not stuck:
        log.info("%-11s 0 draft invoice(s) older than %g days",
                 "clear", args.older_than)
        return 0

    at_stake = sum(r[2] for r in stuck)
    log.warning("%-11s %d stuck draft(s) worth %d in minor units",
                "stuck", len(stuck), at_stake)
    for inv_id, (state, detail), amount, currency in stuck[:args.top]:
        log.warning("  %-11s %s  %d %s  %s", state, inv_id, amount, currency, detail)
        if state == "blocked":
            log.warning("      GET %s/invoices/%s  and read last_finalization_error",
                        API, inv_id)
        else:
            log.warning("      POST %s/invoices/%s/finalize   to bill it", API, inv_id)
            log.warning("      POST %s/invoices/%s  auto_advance=true   to hand it "
                        "back to Stripe", API, inv_id)
    if len(stuck) > args.top:
        log.warning("  ... and %d more", len(stuck) - args.top)
    log.warning("  drafts you never intended to bill are the one kind of invoice "
                "Stripe lets you remove; do that in a separate pass")
    return 1


if __name__ == "__main__":
    sys.exit(main())
