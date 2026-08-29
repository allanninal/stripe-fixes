"""Report Stripe refunds that failed, stalled, or are waiting on the customer.

Read only. One paginated GET, no writes: give this a RESTRICTED key with read
access to Refunds. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_refund_health")

API = "https://api.stripe.com/v1"
PENDING_SECONDS = 10 * 86400

# Reasons where retrying the same card is pointless: the card is gone.
DEAD_CARD = ("expired_or_canceled_card", "lost_or_stolen_card")


def classify(refund, now, pending_after=PENDING_SECONDS):
    """Classify one refund. Pure, so the rules can be tested without a network.

    Returns (state, detail). `failed` and `requires_action` stay apart on purpose:
    the first is money you still owe the customer, the second is an instruction
    you still owe them.
    """
    status = refund.get("status")
    if status == "failed":
        reason = refund.get("failure_reason") or "unknown"
        if reason in DEAD_CARD:
            return ("failed",
                    "%s: the card no longer exists, so a retry fails the same way. "
                    "Refund out of band." % reason)
        return ("failed",
                "%s: the money left your balance and reached nobody" % reason)
    if status == "requires_action":
        return ("needs-action",
                "the customer has to follow refund.next_action before this completes")
    if status == "pending":
        created = refund.get("created")
        if not isinstance(created, int):
            return ("unknown", "pending with no created timestamp, so it cannot be aged")
        days = int((now - created) // 86400)
        if now - created < pending_after:
            return ("pending", "%dd old, inside the normal settlement window" % days)
        return ("stalled",
                "%dd old and still pending (%s)"
                % (days, refund.get("pending_reason") or "no pending_reason"))
    if status in ("succeeded", "canceled"):
        return ("settled", "status %r" % (status,))
    return ("unknown", "unrecognised status %r" % (status,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def refunds(session, since, cap):
    """Yield refunds created since `since`, newest first, up to `cap`."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/refunds", **params)
        data = page.get("data", [])
        for rf in data:
            yield rf
            seen += 1
            if seen >= cap:
                return
        if not page.get("has_more") or not data:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=180,
                    help="how far back to scan (default 180)")
    ap.add_argument("--pending-days", type=int, default=10,
                    help="age at which a pending refund counts as stalled")
    ap.add_argument("--max-refunds", type=int, default=5000,
                    help="stop paginating after this many refunds")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    since = now - args.days * 86400
    pending_after = args.pending_days * 86400

    counts = {}
    by_reason = {}
    lost = 0
    scanned = 0

    for rf in refunds(s, since, args.max_refunds):
        scanned += 1
        state, detail = classify(rf, now, pending_after)
        counts[state] = counts.get(state, 0) + 1
        if state in ("failed", "needs-action", "stalled"):
            log.warning("%s  charge=%s  %s", rf["id"], rf.get("charge") or "?", detail)
        if state == "failed":
            lost += int(rf.get("amount") or 0)
            reason = rf.get("failure_reason") or "unknown"
            by_reason[reason] = by_reason.get(reason, 0) + 1

    failed = counts.get("failed", 0)
    needs = counts.get("needs-action", 0)
    stalled = counts.get("stalled", 0)

    log.info("%d refund(s): %d failed, %d needing action, %d stalled pending",
             scanned, failed, needs, stalled)

    for reason, n in sorted(by_reason.items(), key=lambda kv: -kv[1]):
        log.warning("  %-34s %d", reason, n)

    if failed:
        log.warning("  %d in minor units left your balance and reached nobody", lost)
        log.warning("  repair: subscribe to charge.refund.updated and open a support "
                    "ticket for every status == failed")
        log.warning("  repair: for a dead card, pay the customer out of band; "
                    "retrying the same refund fails identically")
        log.warning("  check: reconcile against failure_balance_transaction so the "
                    "re-credit is not read as a second refund")
    if needs:
        log.warning("  repair: read GET %s/refunds/{id} and send the customer the "
                    "link in next_action", API)
    if stalled:
        log.warning("  check: pending_reason says whether this is settlement, your "
                    "balance, or an unsettled original charge")
    return 1 if (failed or needs or stalled) else 0


if __name__ == "__main__":
    sys.exit(main())
