"""Report Stripe charges that Radar blocked before authorization.

Read only. One paginated GET, no writes: give this a RESTRICTED key with read
access to Charges. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_radar_blocks")

API = "https://api.stripe.com/v1"


def classify(charge):
    """Classify one charge. Pure, so the rules can be tested without a network.

    Returns (state, detail). A blocked charge never reached the issuer, so it has
    no decline code; `outcome.reason` is the only account of what happened.
    """
    outcome = charge.get("outcome") or {}
    if outcome.get("type") != "blocked":
        return ("not-blocked", "outcome.type %r" % (outcome.get("type"),))
    reason = outcome.get("reason") or "unknown"
    seller = outcome.get("seller_message") or "no seller_message"
    if reason == "rule":
        return ("rule",
                "a Radar rule you wrote stopped this before authorization: %s" % seller)
    if reason in ("highest_risk_level", "elevated_risk_level"):
        return ("risk",
                "Radar's own %s threshold, not a rule of yours: %s" % (reason, seller))
    if reason == "low_probability_of_authorization":
        return ("adaptive",
                "Adaptive Acceptance skipped an attempt it expected to fail. "
                "Not fraud; exclude it from fraud metrics.")
    return ("blocked-other", "blocked for %r: %s" % (reason, seller))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def charges(session, since, cap):
    """Yield charges created since `since`, newest first, up to `cap`."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/charges", **params)
        data = page.get("data", [])
        for ch in data:
            yield ch
            seen += 1
            if seen >= cap:
                return
        if not page.get("has_more") or not data:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to scan (default 30)")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating after this many charges")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    counts = {}
    by_reason = {}
    examples = []
    scanned = 0

    for ch in charges(s, since, args.max_charges):
        scanned += 1
        state, detail = classify(ch)
        if state == "not-blocked":
            continue
        counts[state] = counts.get(state, 0) + 1
        reason = (ch.get("outcome") or {}).get("reason") or "unknown"
        n, amount = by_reason.get(reason, (0, 0))
        by_reason[reason] = (n + 1, amount + int(ch.get("amount") or 0))
        if len(examples) < 10:
            examples.append((ch["id"], detail))

    for cid, detail in examples:
        log.warning("%s  %s", cid, detail)

    blocked = sum(counts.values())
    share = (100.0 * blocked / scanned) if scanned else 0.0
    log.info("%d charge(s): %d blocked (%.1f%%) - rule %d, risk %d, adaptive %d",
             scanned, blocked, share, counts.get("rule", 0),
             counts.get("risk", 0), counts.get("adaptive", 0))

    for reason, (n, amount) in sorted(by_reason.items(), key=lambda kv: -kv[1][0]):
        log.warning("  %-32s %4d charge(s), %d in minor units", reason, n, amount)

    if share > 2:
        log.warning("  blocked charges are over 2%% of volume, which is high enough "
                    "to be costing real revenue")
    if counts.get("rule"):
        log.warning("  repair: Dashboard > Radar > Rules, find the rule named in "
                    "outcome.seller_message and narrow its scope or disable it")
    if counts.get("risk"):
        log.warning("  repair: add a review rule before moving the block threshold, "
                    "so risky payments queue rather than vanish")
    if counts.get("adaptive"):
        log.warning("  note: low_probability_of_authorization is Adaptive Acceptance "
                    "working; exclude it from fraud metrics rather than 'fixing' it")
    return 1 if (counts.get("rule") or counts.get("risk")) else 0


if __name__ == "__main__":
    sys.exit(main())
