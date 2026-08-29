"""Report Stripe early fraud warnings that can still be refunded.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Early Fraud Warnings and Charges. The refund is printed, never issued, because
this script holds a credential to a live payments account and a refund cannot be
undone.
"""
import argparse
import collections
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_efw_actionable")

API = "https://api.stripe.com/v1"


def classify(efw, charge, now):
    """Classify one warning against its charge. Pure. Returns (state, detail).

    `charge` is the charge object the warning names, or None if it could not be
    read. The state that costs money is `actionable`: the issuer has reported
    fraud, no dispute has been filed yet, and the money is still yours to give
    back.
    """
    if not efw.get("actionable", False):
        return ("not_actionable",
                "Stripe no longer counts this as actionable: it has already "
                "been disputed or fully refunded")
    if charge is None:
        return ("unknown", "the charge named by this warning could not be read")

    if charge.get("disputed"):
        return ("escalated",
                "the warning became a dispute. The refund window is closed, the "
                "dispute fee applies, and it now counts twice toward the ratio.")

    amount = charge.get("amount") or 0
    refunded = charge.get("amount_refunded") or 0
    if charge.get("refunded") or (amount and refunded >= amount):
        return ("refunded", "fully refunded before it could escalate")
    if refunded:
        return ("partial",
                "%d of %d refunded. A partial refund does not close the window: "
                "the warning is still actionable and can still become a dispute."
                % (refunded, amount))

    created = efw.get("created")
    if created is None:
        return ("actionable", "unrefunded, with no created timestamp to age it by")
    days = (now - created) / 86400.0
    return ("actionable",
            "%.1f day(s) old, %d %s unrefunded, no dispute filed yet"
            % (days, amount, (charge.get("currency") or "?").upper()))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def warnings(session, since, limit):
    """Yield early fraud warnings created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(session, "/radar/early_fraud_warnings", params)
        data = (page or {}).get("data", [])
        for w in data:
            yield w
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def charge_id(efw):
    """The warning carries `charge` as an id, or expanded as an object."""
    ch = efw.get("charge")
    return ch.get("id") if isinstance(ch, dict) else ch


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read warnings")
    ap.add_argument("--max-warnings", type=int, default=1000,
                    help="stop paginating after this many warnings")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    since = now - args.days * 86400
    types = collections.Counter()
    rows = []
    seen = 0

    for w in warnings(s, since, args.max_warnings):
        seen += 1
        types[w.get("fraud_type") or "unknown"] += 1
        cid = charge_id(w)
        # Only actionable warnings are worth a second request; Stripe has
        # already done the dispute and refund bookkeeping behind that flag.
        charge = get(s, "/charges/" + cid) if (w.get("actionable") and cid) else None
        state, detail = classify(w, charge, now)
        if state in ("actionable", "partial", "unknown"):
            rows.append((w.get("created") or 0, w, cid, state, detail))

    # Oldest first: the window is the thing being raced, and a fresh warning
    # worth more can wait a day where a two week old one cannot.
    for _created, w, cid, state, detail in sorted(rows, key=lambda r: r[0]):
        log.warning("%-12s %s  charge=%s  %s  %s",
                    state, w.get("id", "?"), cid, w.get("fraud_type", "?"), detail)
        if state == "unknown":
            continue
        log.warning("  repair: POST %s/refunds -d charge=%s -d reason=fraudulent",
                    API, cid)
        log.warning("  or Dashboard, the payment, Refund as fraud, which also adds "
                    "the card fingerprint and email to your block lists")

    log.info("%d warning(s) read, %d actionable and unrefunded", seen, len(rows))
    if types:
        log.info("by fraud_type: %s",
                 ", ".join("%s=%d" % (k, v) for k, v in types.most_common()))
        top, count = types.most_common(1)[0]
        if seen and count >= 10 and count / seen > 0.5:
            log.warning("%d of %d warnings are %s: that is a campaign, and a Radar "
                        "rule will do more than %d refunds", count, seen, top, count)
    log.info("subscribe to radar.early_fraud_warning.created so this sweep is a "
             "backstop rather than the only notice you get")
    return 1 if rows else 0


if __name__ == "__main__":
    sys.exit(main())
