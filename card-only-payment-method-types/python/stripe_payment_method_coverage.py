"""Report PaymentIntents that pin payment_method_types instead of using
dynamic payment methods, and enabled methods that never reach a customer.

Read only. Two GET requests, no writes: give this a RESTRICTED key with read
access to PaymentIntents and Payment Method Configurations. The repair is
printed, never performed.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payment_method_coverage")

API = "https://api.stripe.com/v1"

# Sorted lists, because the comparison below sorts before matching. "card" alone
# is the classic tutorial line; "card" plus "link" is what it becomes after Link
# is switched on and the array is edited rather than removed.
CARD_ONLY = (["card"], ["card", "link"])


def is_card_only(intent):
    """True when this intent pinned an explicit card-only method list. Pure.

    `payment_method_types` is populated on every intent, dynamic or not, because
    Stripe fills it with whatever it resolved. Only `automatic_payment_methods`
    being absent proves the list was passed in by the caller, so both fields have
    to be read: judging on the types alone flags healthy intents that happened to
    resolve to card.
    """
    if intent.get("automatic_payment_methods"):
        return False
    return sorted(intent.get("payment_method_types") or []) in CARD_ONLY


def enabled_methods(configs):
    """Method names that are available and switched on for this account. Pure.

    A configuration carries one sub-object per method alongside ordinary metadata
    fields, so the method entries are found by shape rather than by name. Read
    `display_preference.value`, the resolved setting, not `preference`, which is
    only what was asked for and can still resolve to off.
    """
    out = set()
    for cfg in configs:
        for name, val in cfg.items():
            if not isinstance(val, dict):
                continue
            pref = val.get("display_preference") or {}
            if val.get("available") and pref.get("value") == "on":
                out.add(name)
    return out


def verdict(stats, enabled):
    """Weigh the intents against the account's enabled methods. Pure.

    stats: {"intents": n, "card_only": n, "offered": iterable of method names}.
    enabled: the set from enabled_methods().
    """
    total = stats.get("intents", 0)
    if not total:
        return ("no_data", "no PaymentIntents in the window: nothing to judge")

    card_only = stats.get("card_only", 0)
    unused = sorted(enabled - set(stats.get("offered") or ()))

    if card_only >= total * 0.8:
        return ("hardcoded",
                "%d of %d intent(s) pin payment_method_types to card, so dynamic "
                "payment methods are bypassed. Enabled and never offered: %s"
                % (card_only, total, ", ".join(unused) or "(nothing else)"))
    if card_only:
        return ("partial",
                "%d of %d intent(s) still pin payment_method_types: one creation "
                "site was migrated and another was not" % (card_only, total))
    if unused:
        return ("unused",
                "dynamic methods are on everywhere, but %s never appeared on an "
                "intent: check currency, country and amount eligibility"
                % ", ".join(unused))
    return ("healthy", "every enabled method reaches at least one intent")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to " + path)
    r.raise_for_status()
    return r.json()


def sample_intents(session, since, cap):
    """Walk recent intents and tally what they pinned and what they offered."""
    stats = {"intents": 0, "card_only": 0}
    offered = set()
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/payment_intents", **params)
        rows = page.get("data", [])
        for pi in rows:
            stats["intents"] += 1
            if is_card_only(pi):
                stats["card_only"] += 1
            offered.update(pi.get("payment_method_types") or [])
        if not rows or not page.get("has_more") or stats["intents"] >= cap:
            break
        params["starting_after"] = rows[-1]["id"]
    stats["offered"] = offered
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30, help="how far back to sample")
    ap.add_argument("--max-intents", type=int, default=2000,
                    help="stop sampling after this many intents")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    stats = sample_intents(s, since, args.max_intents)
    configs = get(s, "/payment_method_configurations", limit=100).get("data", [])
    enabled = enabled_methods(configs)

    state, detail = verdict(stats, enabled)
    line = "%-9s %s" % (state, detail)
    if state in ("healthy", "no_data"):
        log.info(line)
        return 0

    log.warning(line)
    if state in ("hardcoded", "partial"):
        log.warning("  repair: drop payment_method_types from the create call")
        log.warning('  repair: POST %s/payment_intents -d amount=1099 -d currency=eur '
                    '-d "automatic_payment_methods[enabled]=true"', API)
        log.warning("  repair: use excluded_payment_method_types for one-off "
                    "exclusions rather than an allowlist")
    else:
        log.warning("  repair: confirm currency, country and amount eligibility at "
                    "https://dashboard.stripe.com/settings/payment_methods")
    log.info("sampled %d intent(s); offered %d method(s); enabled %d",
             stats["intents"], len(stats.get("offered") or ()), len(enabled))
    return 1


if __name__ == "__main__":
    sys.exit(main())
