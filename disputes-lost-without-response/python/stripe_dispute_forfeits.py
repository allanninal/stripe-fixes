"""Measure how many lost Stripe disputes were forfeited rather than decided.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Disputes. The repair is a process change, printed for a human, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dispute_forfeits")

API = "https://api.stripe.com/v1"

# Above this share of losses, the dispute process is not merely leaky.
FORFEIT_ALARM = 0.30


def verdict(lost, forfeited, won):
    """Classify a window of closed disputes. Pure, so both ratios can be tested.

    `forfeited` is the subset of `lost` that closed with submission_count 0,
    meaning the deadline passed rather than the evidence failing.
    Returns (state, detail).
    """
    if lost + won == 0:
        return ("no_disputes", "no dispute closed as won or lost in this window")
    if forfeited > lost:
        return ("unknown",
                "%d forfeit(s) against %d loss(es); the counts disagree"
                % (forfeited, lost))
    if lost == 0:
        return ("clean", "%d dispute(s) closed, none lost" % won)

    contested_lost = lost - forfeited
    denom = contested_lost + won
    if denom:
        rate = ("the %d contested dispute(s) lost %.0f%% of the time"
                % (denom, 100.0 * contested_lost / denom))
    else:
        rate = "nothing was contested, so there is no real loss rate to quote"

    if forfeited == 0:
        return ("contested", "%d loss(es), every one answered; %s" % (lost, rate))

    share = 100.0 * forfeited / lost
    body = ("%d of %d loss(es) (%.0f%%) closed with submission_count 0; %s"
            % (forfeited, lost, share, rate))
    if forfeited / float(lost) >= FORFEIT_ALARM:
        return ("absent", body + ". At this share there is no dispute workflow, "
                                 "only a dispute list.")
    return ("leaking", body + ". Each of those was recoverable process loss.")


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def tally(session, since, limit):
    """Count won, lost and forfeited disputes created since `since`.

    Open disputes are ignored on purpose: they belong to the deadline sweep, and
    counting them here moves the ratio for reasons that have nothing to do with
    how the closed ones went.
    """
    lost = forfeited = won = seen = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(session, "/disputes", params)
        data = page.get("data", [])
        for d in data:
            seen += 1
            status = d.get("status")
            if status == "won":
                won += 1
            elif status == "lost":
                lost += 1
                ed = d.get("evidence_details") or {}
                if not (ed.get("submission_count") or 0):
                    forfeited += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return lost, forfeited, won


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=365,
                    help="how far back to count closed disputes")
    ap.add_argument("--max-disputes", type=int, default=5000,
                    help="stop paginating after this many disputes")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = time.time() - args.days * 86400
    lost, forfeited, won = tally(s, since, args.max_disputes)
    state, detail = verdict(lost, forfeited, won)

    line = "%-12s %s" % (state, detail)
    if state in ("no_disputes", "clean", "contested"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  repair: sweep evidence_details.due_by daily and route each "
                "dispute to a named human before it is 72 hours out")
    log.warning("  and pass customer IP, email, shipping address and product "
                "description on every payment, so a response is a review "
                "rather than a research project")
    return 1


if __name__ == "__main__":
    sys.exit(main())
