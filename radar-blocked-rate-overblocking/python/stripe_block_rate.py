"""Report a Stripe account where Radar blocks too large a share of attempts.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
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
log = logging.getLogger("stripe_block_rate")

API = "https://api.stripe.com/v1"

HIGH_RATE = 0.05    # one attempt in twenty stopped before the issuer saw it
WATCH_RATE = 0.02   # worth a look before it becomes the conversion investigation
DOMINANT = 0.5      # one predicate causing at least half of the blocks
MOSTLY_NORMAL = 0.8  # and those charges scoring normal risk, not elevated


def verdict(total, blocked, adaptive=0, top_rule=None):
    """Classify one window of charge attempts. Pure, so the thresholds are testable.

    `total` is every charge attempt in the window, `blocked` the ones Radar stopped,
    `adaptive` the subset blocked as low_probability_of_authorization, and
    `top_rule` is (predicate, blocked_count, normal_risk_count) for the single
    predicate responsible for the most blocks, or None. Returns (state, detail).
    """
    if not total:
        return ("no-data", "no charge attempts in the window")
    if not blocked:
        return ("normal", "no blocked charges in %d attempt(s)" % total)

    own = max(blocked - adaptive, 0)
    if not own:
        return ("adaptive-only",
                "%d of %d attempt(s) blocked (%.1f%%), every one of them "
                "low_probability_of_authorization: that is Adaptive Acceptance "
                "skipping a decline, not a rule of yours"
                % (blocked, total, 100.0 * blocked / total))

    pct = 100.0 * own / total
    if own / float(total) >= HIGH_RATE:
        if top_rule:
            predicate, count, normal = top_rule
            if (count >= DOMINANT * own
                    and count and normal >= MOSTLY_NORMAL * count):
                return ("overblocking-rule",
                        "%d of %d attempt(s) blocked (%.1f%%), and %d of those came "
                        "from one predicate (%s) on charges Radar scored normal risk"
                        % (own, total, pct, count, predicate))
        return ("elevated",
                "%d of %d attempt(s) blocked by rules or risk (%.1f%%), spread "
                "across predicates: check the risk threshold as well as the rules"
                % (own, total, pct))
    if own / float(total) >= WATCH_RATE:
        return ("watch",
                "%d of %d attempt(s) blocked by rules or risk (%.1f%%). Track it as "
                "a series; a step change dates the rule edit." % (own, total, pct))
    return ("normal",
            "%d of %d attempt(s) blocked by rules or risk (%.1f%%)"
            % (own, total, pct))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def scan(session, since, until, cap):
    """Tally blocks across one window.

    outcome.rule is expanded in the request, because unexpanded it is an id and the
    predicate is the only part of it worth reading.
    """
    total = blocked = adaptive = 0
    per_rule = {}
    params = {"created[gte]": since, "created[lt]": until, "limit": 100,
              "expand[]": "data.outcome.rule"}
    while True:
        page = get(session, "/charges", params)
        data = page.get("data", [])
        for charge in data:
            total += 1
            outcome = charge.get("outcome") or {}
            if outcome.get("type") != "blocked":
                continue
            blocked += 1
            reason = outcome.get("reason")
            if reason == "low_probability_of_authorization":
                adaptive += 1
                continue
            rule = outcome.get("rule")
            if isinstance(rule, dict):
                predicate = rule.get("predicate") or rule.get("id") or "<no predicate>"
            elif rule:
                predicate = str(rule)
            else:
                predicate = reason or "<no rule>"
            count, normal = per_rule.get(predicate, (0, 0))
            per_rule[predicate] = (
                count + 1,
                normal + (1 if outcome.get("risk_level") == "normal" else 0))
        if not data or not page.get("has_more") or total >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return total, blocked, adaptive, per_rule


def worst(per_rule):
    """The predicate with the most blocks, as (predicate, count, normal_risk)."""
    if not per_rule:
        return None
    predicate, (count, normal) = max(per_rule.items(), key=lambda kv: kv[1][0])
    return (predicate, count, normal)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="window to measure, in days (keep it fixed between runs)")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating after this many charges per window")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    span = args.days * 86400
    total, blocked, adaptive, per_rule = scan(s, now - span, now, args.max_charges)
    state, detail = verdict(total, blocked, adaptive, worst(per_rule))

    log.info("%-17s %s", state, detail)
    if adaptive:
        log.info("  %d adaptive block(s) excluded (low_probability_of_authorization)",
                 adaptive)
    for predicate, (count, normal) in sorted(per_rule.items(),
                                             key=lambda kv: -kv[1][0])[:5]:
        log.info("  %4d blocked  %4d at normal risk  %s", count, normal, predicate)

    prev_total, prev_blocked, prev_adaptive, _ = scan(
        s, now - 2 * span, now - span, args.max_charges)
    if prev_total:
        log.info("  previous window: %.1f%% blocked by rules or risk",
                 100.0 * max(prev_blocked - prev_adaptive, 0) / prev_total)

    if state in ("normal", "no-data", "adaptive-only"):
        return 0
    log.warning("  repair: narrow the predicate in Dashboard > Radar > Rules rather "
                "than deleting the rule, e.g. add: and :risk_level: = 'elevated'")
    log.warning("  or convert it to a review rule while you gather data, and check "
                "its estimated false positive rate before re-enabling")
    return 1


if __name__ == "__main__":
    sys.exit(main())
