"""Report Stripe charges Radar scored as highest risk that succeeded anyway.

Read only. Paginated GETs and nothing else: give this a RESTRICTED key with read
access to Charges, Disputes and Radar. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_highest_risk_succeeded")

API = "https://api.stripe.com/v1"

LEAKING = ("allowed", "leaked", "uncaptured")


def verdict(risk_level, status, captured, rule):
    """Classify one charge. Pure, so the precedence rules can be tested offline.

    `rule` is the charge's outcome.rule: None, a rule id string, or the expanded
    object carrying `action` and `predicate`. Returns (state, detail).
    """
    if risk_level in (None, "not_assessed"):
        return ("not_assessed",
                "Radar never scored this charge: no Radar session reached the API")
    if risk_level != "highest":
        return ("baseline", "risk_level %s, outside the scope of this check" % risk_level)
    if status != "succeeded":
        return ("stopped", "highest risk and status %s: the block held" % status)
    if not captured:
        return ("uncaptured",
                "highest risk, authorized but not captured: cancel the payment "
                "intent before the hold is captured or expires")
    action = rule.get("action") if isinstance(rule, dict) else None
    if action == "allow":
        predicate = rule.get("predicate") or rule.get("id") or "unnamed"
        return ("allowed",
                "highest risk and captured because an allow rule matched first: %s"
                % predicate)
    return ("leaked",
            "highest risk and captured with no rule named: the built-in highest "
            "risk block rule is not in force on this account")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page(session, path, cap, **params):
    out = []
    params = dict(params)
    params["limit"] = 100
    while True:
        p = get(session, path, **params)
        data = p.get("data", [])
        out.extend(data)
        if not data or not p.get("has_more") or len(out) >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def fraud_charge_ids(session, cap):
    """Charge ids carrying an early fraud warning or a dispute."""
    ids = set()
    for efw in page(session, "/radar/early_fraud_warnings", cap):
        if efw.get("charge"):
            ids.add(efw["charge"] if isinstance(efw["charge"], str)
                    else efw["charge"].get("id"))
    for dispute in page(session, "/disputes", cap):
        if dispute.get("charge"):
            ids.add(dispute["charge"] if isinstance(dispute["charge"], str)
                    else dispute["charge"].get("id"))
    return {i for i in ids if i}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read charges")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating after this many charges")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time() - args.days * 86400)
    charges = page(s, "/charges", args.max_charges, **{"created[gte]": since})

    leaking = []
    counts = {}
    for ch in charges:
        outcome = ch.get("outcome") or {}
        state, detail = verdict(outcome.get("risk_level"), ch.get("status"),
                                ch.get("captured"), outcome.get("rule"))
        counts[state] = counts.get(state, 0) + 1
        if state in LEAKING:
            leaking.append((ch, state, detail))

    log.info("%d charge(s): %d highest-risk captured, %d stopped",
             len(charges), counts.get("allowed", 0) + counts.get("leaked", 0),
             counts.get("stopped", 0))
    if counts.get("not_assessed"):
        log.warning("%d charge(s) were never scored by Radar. Mount Stripe.js on the "
                    "payment page, or pass radar_options[session] on server-side "
                    "confirms, before tuning any rule.",
                    counts["not_assessed"])

    if not leaking:
        return 1 if counts.get("not_assessed") else 0

    fraud = fraud_charge_ids(s, 1000)
    hits = 0
    for ch, state, detail in leaking:
        marker = ""
        if ch.get("id") in fraud:
            hits += 1
            marker = "  [early fraud warning or dispute on this charge]"
        log.warning("%-12s %s %s%s", state, ch.get("id"), detail, marker)

    log.warning("  %d of %d leaked charge(s) already carry fraud evidence",
                hits, len(leaking))
    log.warning("  guard every allow rule in Dashboard, Radar, Rules by appending "
                "and :risk_level: != 'highest' to its predicate")
    log.warning("  then confirm the built-in rule if :risk_level: = 'highest' is "
                "still enabled")
    return 1


if __name__ == "__main__":
    sys.exit(main())
