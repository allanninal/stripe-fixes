"""Report Stripe pre-dispute inquiries that nobody has answered.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Disputes. The response is printed, never submitted, because this script
holds a credential to a live payments account and dispute evidence can be sent
exactly once per dispute.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dispute_inquiries")

API = "https://api.stripe.com/v1"

CRITICAL_HOURS = 72.0

# The inquiry side of the escalation line. No funds have moved and none of these
# are counted by a card network monitoring programme yet.
INQUIRY_OPEN = ("warning_needs_response",)
INQUIRY_ANSWERED = ("warning_under_review",)
INQUIRY_CLOSED = ("warning_closed",)

# The chargeback side. Funds are withdrawn, the dispute fee is charged, and the
# dispute counts toward the ratio whether it is later won or lost.
CHARGEBACK = ("needs_response", "under_review", "won", "lost")


def family(status):
    """Which side of the escalation line a dispute status sits on. Pure.

    This exists as its own function because the bug is almost always here: an
    integration matching only the four bare statuses drops every inquiry on the
    floor, and a list that is too short is invisible in a longer function.
    """
    if status in INQUIRY_OPEN + INQUIRY_ANSWERED + INQUIRY_CLOSED:
        return "inquiry"
    if status in CHARGEBACK:
        return "chargeback"
    return "unknown"


def classify(dispute, now, critical_hours=CRITICAL_HOURS):
    """Classify one dispute. Pure, so the deadline arithmetic can be tested.

    `now` is a unix timestamp. Returns (state, detail).

    The state that costs money is `unanswered`, and its worst variant is
    `staged`: evidence written and never sent, which forfeits the inquiry with
    the work already paid for.
    """
    status = dispute.get("status")
    side = family(status)

    if side == "unknown":
        return ("unknown", "unrecognised status %r" % (status,))
    if side == "chargeback":
        return ("escalated",
                "already a chargeback (%s). The funds and the dispute fee are "
                "gone and it counts toward the network ratio either way." % status)
    if status in INQUIRY_CLOSED:
        return ("closed", "inquiry closed without escalating")
    if status in INQUIRY_ANSWERED:
        return ("answered", "evidence is in and the issuer is reviewing it")

    ed = dispute.get("evidence_details") or {}
    due_by = ed.get("due_by")
    staged = bool(ed.get("has_evidence"))
    sent = ed.get("submission_count") or 0

    if sent:
        return ("answered", "%d submission(s) already sent" % sent)
    if staged:
        return ("staged",
                "evidence is staged but submission_count is 0. Nothing has "
                "reached the issuer, and doing nothing is not the same as "
                "accepting: only evidence closes an inquiry.")
    if due_by is None:
        return ("unanswered", "open inquiry with no due_by to measure against")

    hours = (due_by - now) / 3600.0
    if hours <= 0:
        return ("lapsing",
                "past due_by while unanswered. Expect this to escalate into a "
                "formal chargeback, with the fee and the ratio entry attached.")
    if hours <= critical_hours:
        return ("critical", "%.1f hour(s) left and nothing attached." % hours)
    return ("unanswered", "%.1f day(s) left to answer before escalation" % (hours / 24.0))


def money(dispute):
    """Amount at stake, in minor units.

    Not divided by 100, which is wrong for zero-decimal currencies such as JPY.
    A report that reads 100x low on one currency is worse than one that makes
    you read the currency code.
    """
    return "%s %s" % (dispute.get("amount"), (dispute.get("currency") or "?").upper())


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def disputes(session, limit):
    """Yield disputes, newest first, up to `limit`.

    Deliberately unfiltered. A server-side status filter is how the inquiries
    got missed in the first place.
    """
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
    counts = {"inquiry": 0, "chargeback": 0, "unknown": 0}
    open_inquiries = 0

    # Newest first, so collect and sort by deadline before printing: the order
    # the API returns them in is not the order you should work them in.
    rows = []
    for d in disputes(s, args.max_disputes):
        counts[family(d.get("status"))] += 1
        state, detail = classify(d, now, args.hours)
        if state in ("unanswered", "critical", "staged", "lapsing"):
            open_inquiries += 1
            rows.append(((d.get("evidence_details") or {}).get("due_by") or 0,
                         d, state, detail))

    for _due, d, state, detail in sorted(rows, key=lambda r: r[0]):
        log.warning("%-10s %s  %s  %s", state, d.get("id", "?"), money(d), detail)
        log.warning("  repair: POST %s/disputes/%s "
                    "-d 'evidence[uncategorized_text]=...' "
                    "-d 'evidence[product_description]=...' "
                    "-d 'evidence[shipping_tracking_number]=...'",
                    API, d["id"])
        log.warning("  evidence submits once per dispute, so assemble it all first")

    total = sum(counts.values())
    log.info("%d dispute(s) read: %d inquiry, %d chargeback, %d inquiry needing "
             "a response", total, counts["inquiry"], counts["chargeback"],
             open_inquiries)
    if counts["inquiry"] and counts["chargeback"] > counts["inquiry"]:
        log.info("more chargebacks than inquiries in this window: check that "
                 "charge.dispute.created is routed on statuses starting warning_")
    return 1 if open_inquiries else 0


if __name__ == "__main__":
    sys.exit(main())
