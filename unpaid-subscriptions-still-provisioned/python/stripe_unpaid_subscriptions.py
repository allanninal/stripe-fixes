"""Report unpaid subscriptions and the draft invoices stranded behind them.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Subscriptions and Invoices. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_unpaid_subscriptions")

API = "https://api.stripe.com/v1"


def verdict(sub, drafts):
    """Classify one subscription and the draft invoices behind it.

    `drafts` is this subscription's invoices already filtered to status draft.
    Pure, so the rules are visible and testable without a network.
    Returns (state, detail).
    """
    status = sub.get("status")
    if status != "unpaid":
        return ("not-unpaid",
                "status is %r, which is a different problem than this one"
                % (status,))

    # auto_advance false is Stripe saying this invoice will never finalise by
    # itself. On an unpaid subscription that is every invoice it generates.
    closed = [d for d in drafts if not d.get("auto_advance")]
    if closed:
        owed = sum(d.get("amount_due") or 0 for d in closed)
        return ("stranded",
                "%d draft invoice(s) worth %d (minor units) were created and "
                "closed without a payment attempt" % (len(closed), owed))
    if drafts:
        return ("collecting",
                "%d draft invoice(s) still carry auto_advance, so somebody has "
                "already restarted collection here" % len(drafts))
    return ("silent",
            "no invoices since dunning ended. Billing stopped at the last "
            "past_due invoice and access is whatever your app still grants.")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Walk a Stripe list endpoint, stopping at `limit` objects."""
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
    ap.add_argument("--max-subscriptions", type=int, default=500,
                    help="stop after this many unpaid subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = page_all(s, "/subscriptions", args.max_subscriptions, status="unpaid")
    if not subs:
        log.info("0 unpaid subscription(s), 0 stranded draft invoice(s)")
        return 0

    stranded = 0
    for sub in subs:
        drafts = page_all(s, "/invoices", 100, subscription=sub["id"], status="draft")
        state, detail = verdict(sub, drafts)
        log.warning("%-11s %s  %s", state, sub["id"], detail)
        if state == "stranded":
            stranded += len(drafts)
            log.warning("  repair: for each draft, POST %s/invoices/{inv} "
                        "-d auto_advance=true (or /send to mail it)", API)
        log.warning("  repair: gate provisioning on status in (active, trialing); "
                    "unpaid must revoke")
        log.warning("  repair: Billing, Revenue recovery, Retries: set the final "
                    "action to cancel instead of mark unpaid")

    log.info("%d unpaid subscription(s), %d stranded draft invoice(s)",
             len(subs), stranded)
    return 1


if __name__ == "__main__":
    sys.exit(main())
