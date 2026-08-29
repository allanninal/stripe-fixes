"""Report Stripe charges scored elevated risk that were captured with no review.

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
log = logging.getLogger("stripe_elevated_risk_review")

API = "https://api.stripe.com/v1"


def verdict(charge):
    """Classify one Charge by what happened to an elevated risk score. Pure.

    Radar's default rules block `highest` and leave `elevated` alone, so an
    elevated charge is authorized and captured unless a review rule puts it in
    front of a human. `review` is null both when no such rule exists and on a
    perfectly healthy account, which is why the surrounding fields decide the
    verdict rather than that one on its own.

    Returns (state, detail).
    """
    outcome = charge.get("outcome") or {}
    risk = outcome.get("risk_level")

    if risk in (None, "not_assessed"):
        return ("not_assessed",
                "Radar never scored this charge: no Radar session reached the API, "
                "so no rule of any kind could have matched it")

    if risk != "elevated":
        return ("baseline", "risk_level %s, outside the scope of this check" % risk)

    if outcome.get("type") != "authorized":
        return ("stopped",
                "elevated and outcome.type %r: something already stopped it"
                % (outcome.get("type"),))

    if charge.get("review"):
        return ("reviewed", "elevated and placed in the manual review queue")

    if not charge.get("captured"):
        return ("uncaptured",
                "elevated and unreviewed, authorized but not captured: this is "
                "still a hold and it can be released rather than taken")

    if charge.get("disputed"):
        return ("disputed",
                "elevated, captured with no review in front of it, and already "
                "disputed: this one is the bill for the missing rule")

    return ("straight-through",
            "elevated risk, authorized, captured, and no human ever saw it")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_charges(session, since, limit):
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/charges", **params)
        rows = page.get("data", [])
        for charge in rows:
            yield charge
            seen += 1
        if not page.get("has_more") or not rows or seen >= limit:
            break
        params["starting_after"] = rows[-1]["id"]


def rate(disputed, total):
    return (100.0 * disputed / total) if total else 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to scan charges (default 90)")
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

    states = {}
    scanned = 0
    unreviewed_amount = {}
    normal_total = normal_disputed = 0
    elevated_total = elevated_disputed = 0

    for charge in page_charges(s, since, args.max_charges):
        scanned += 1
        state, detail = verdict(charge)
        states[state] = states.get(state, 0) + 1

        risk = (charge.get("outcome") or {}).get("risk_level")
        if risk == "normal" and charge.get("captured"):
            normal_total += 1
            normal_disputed += 1 if charge.get("disputed") else 0
        elif risk == "elevated" and charge.get("captured"):
            elevated_total += 1
            elevated_disputed += 1 if charge.get("disputed") else 0

        if state in ("straight-through", "disputed", "uncaptured"):
            currency = charge.get("currency") or "???"
            unreviewed_amount[currency] = (unreviewed_amount.get(currency, 0)
                                           + (charge.get("amount") or 0))
            log.warning("%-16s %s  %s", state, charge.get("id", "?"), detail)

    if not scanned:
        log.info("no charges in the last %d day(s)", args.days)
        return 0

    log.info("%d charge(s) in %d day(s): %s", scanned, args.days,
             ", ".join("%d %s" % (n, k) for k, n in sorted(states.items())))

    not_assessed = states.get("not_assessed", 0)
    if not_assessed > scanned / 2:
        log.warning("%d of %d charges are not_assessed: Radar is not scoring this "
                    "traffic, so fix that before adding any rule", not_assessed, scanned)
        log.warning("repair: mount Stripe.js on the payment page, or pass "
                    "radar_options[session] on server-side confirms")
        return 1

    leaked = states.get("straight-through", 0) + states.get("disputed", 0)
    if not leaked and not states.get("uncaptured", 0):
        log.info("no elevated-risk charge was captured without a review")
        return 0

    for currency, amount in sorted(unreviewed_amount.items()):
        log.warning("elevated and unreviewed: %.2f %s", amount / 100.0, currency.upper())
    log.warning("dispute rate: elevated %.2f%% (%d/%d) vs normal %.2f%% (%d/%d)",
                rate(elevated_disputed, elevated_total), elevated_disputed, elevated_total,
                rate(normal_disputed, normal_total), normal_disputed, normal_total)
    log.warning("repair: Dashboard, Radar, Rules: add \"Place in review if "
                ":risk_level: = 'elevated'\", scoped by amount if the queue is "
                "too large to work daily")
    log.warning("repair: give the review queue an owner; a queue nobody works "
                "expires its own payments and is worse than no queue")
    return 1


if __name__ == "__main__":
    sys.exit(main())
