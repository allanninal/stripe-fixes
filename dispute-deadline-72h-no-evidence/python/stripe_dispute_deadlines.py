"""Report Stripe disputes whose response deadline is about to pass.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Disputes. The response is printed, never submitted, because this script
holds a credential to a live payments account and dispute evidence can be sent
exactly once.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dispute_deadlines")

API = "https://api.stripe.com/v1"

CRITICAL_HOURS = 72.0

# Still waiting on you.
OPEN = ("needs_response", "warning_needs_response")
# Answered; the network has it.
IN_REVIEW = ("under_review", "warning_under_review")
# Finished either way.
SETTLED = ("won", "lost", "warning_closed")


def verdict(dispute, now, critical_hours=CRITICAL_HOURS):
    """Classify one dispute. Pure, so the deadline arithmetic can be tested.

    `now` is a unix timestamp. Returns (state, detail).

    The states that matter are `critical` (deadline close, nothing sent) and
    `staged` (deadline close, evidence written but submission_count still 0),
    which is the same loss with the work already paid for.
    """
    status = dispute.get("status")
    ed = dispute.get("evidence_details") or {}

    if status in IN_REVIEW:
        return ("submitted", "evidence is in and the network is reviewing it")
    if status in SETTLED:
        return ("closed", "closed as %s; there is nothing left to send" % status)
    if status not in OPEN:
        return ("unknown", "unrecognised status %r" % (status,))

    due_by = ed.get("due_by")
    staged = bool(ed.get("has_evidence"))
    sent = ed.get("submission_count") or 0

    if ed.get("past_due") or (due_by is not None and due_by <= now):
        return ("forfeited",
                "past due_by while still needing a response. The funds and the "
                "dispute fee are gone, and no evidence will be accepted now.")
    if due_by is None:
        return ("unknown", "open, but with no due_by to measure against")

    hours = (due_by - now) / 3600.0
    if hours <= critical_hours:
        if staged and not sent:
            return ("staged",
                    "%.1f hour(s) left. Evidence is staged but submission_count "
                    "is 0, so none of it has reached the network." % hours)
        return ("critical", "%.1f hour(s) left and nothing attached." % hours)
    if staged and not sent:
        return ("open",
                "%.1f day(s) left; evidence staged, not submitted" % (hours / 24.0))
    return ("open", "%.1f day(s) left to assemble evidence" % (hours / 24.0))


def money(dispute):
    """Amount at risk, in minor units.

    Deliberately not divided by 100: that is wrong for zero-decimal currencies
    like JPY, and a report that quietly reads 100x low on one currency is worse
    than one that makes you read the currency code.
    """
    return "%s %s" % (dispute.get("amount"), (dispute.get("currency") or "?").upper())


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def disputes(session, limit):
    """Yield disputes, newest first, up to `limit`."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/disputes", params)
        data = page.get("data", [])
        for d in data:
            yield d
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hours", type=float, default=CRITICAL_HOURS,
                    help="how close to due_by counts as critical")
    ap.add_argument("--max-disputes", type=int, default=1000,
                    help="stop paginating after this many disputes")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    seen = urgent = 0
    for d in disputes(s, args.max_disputes):
        seen += 1
        state, detail = verdict(d, now, args.hours)
        if state in ("submitted", "closed", "open"):
            log.info("%-10s %s  %s", state, d.get("id", "?"), detail)
            continue

        urgent += 1
        log.warning("%-10s %s  %s  %s", state, d.get("id", "?"), money(d), detail)
        if state == "unknown":
            continue
        if state == "forfeited":
            log.warning("  nothing to run: the window is closed. Count it with the "
                        "other forfeits and fix the sweep, not this dispute.")
            continue
        log.warning("  repair: POST %s/disputes/%s "
                    "-d 'evidence[product_description]=...' "
                    "-d 'evidence[shipping_tracking_number]=...' "
                    "-d 'evidence[customer_communication]=<file_id>'",
                    API, d["id"])
        log.warning("  evidence submits once, so assemble it all first. "
                    "To concede on purpose: POST %s/disputes/%s/close", API, d["id"])
        if "visa_compelling_evidence_3" in (d.get("enhanced_eligibility_types") or []):
            log.warning("  eligible for Visa Compelling Evidence 3.0: Stripe "
                        "pre-populates most of this from prior transactions")

    log.info("%d dispute(s) read, %d needing a response now", seen, urgent)
    return 1 if urgent else 0


if __name__ == "__main__":
    sys.exit(main())
