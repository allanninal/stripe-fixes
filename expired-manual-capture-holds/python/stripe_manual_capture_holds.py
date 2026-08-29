"""Report Stripe manual-capture authorizations about to expire, or already lost.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to PaymentIntents and Charges. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_manual_capture_holds")

API = "https://api.stripe.com/v1"


def classify(intent, now, warn_seconds=48 * 3600):
    """Sort one PaymentIntent by how much of its authorization window is left.

    Pure, and `now` is passed in rather than read, so the states that matter
    here -- two hours left, an hour past, no deadline at all -- can be tested
    without waiting a week for a real one.

    The deadline is `capture_before` on the charge, not a fixed number of days
    after `created`: the window is roughly 7 days for most card-not-present
    transactions but shorter for several common types, so anything computed
    locally is wrong for whichever type it was not written against.

    Returns (state, detail).
    """
    if intent.get("capture_method") != "manual":
        return ("automatic", "captured automatically, no hold to lose")

    status = intent.get("status")

    if status == "succeeded":
        return ("captured", "captured inside the window")

    if status == "canceled":
        if intent.get("cancellation_reason") == "automatic":
            return ("lost",
                    "the authorization expired uncaptured: Stripe canceled it, "
                    "the hold was released, and no capture can take the money now")
        return ("canceled",
                "canceled deliberately (%s)"
                % (intent.get("cancellation_reason") or "no reason recorded"))

    if status != "requires_capture":
        return ("open", "status %s: nothing is authorised yet" % (status,))

    charge = intent.get("latest_charge")
    if not isinstance(charge, dict):
        return ("unknown",
                "requires_capture with no expanded charge: add "
                "expand[]=data.latest_charge, and do not assume seven days")

    card = ((charge.get("payment_method_details") or {}).get("card") or {})
    capture_before = card.get("capture_before")
    if not capture_before:
        return ("unknown",
                "requires_capture with no capture_before on the charge: the "
                "deadline is unknown, which is not the same as far away")

    left = int(capture_before) - int(now)
    if left <= 0:
        return ("expired",
                "capture_before passed %dh ago: the hold is gone even if the "
                "status has not caught up" % (-left // 3600))
    if left <= warn_seconds:
        return ("expiring",
                "%dh left to capture: past that the funds are released to the "
                "cardholder" % (left // 3600))
    return ("held", "%dh left to capture" % (left // 3600))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def intents(session, since, cap):
    """Yield PaymentIntents with their charge expanded, paginating to the cap."""
    seen = 0
    params = {"limit": 100, "created[gte]": since,
              "expand[]": "data.latest_charge"}
    while True:
        page = get(session, "/payment_intents", **params)
        data = page.get("data", [])
        for pi in data:
            yield pi
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to read intents")
    ap.add_argument("--warn-hours", type=int, default=48,
                    help="flag holds with less than this much time left")
    ap.add_argument("--max-intents", type=int, default=20000,
                    help="stop paginating after this many intents")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    since = now - args.days * 86400
    counts, lost_amount = {}, 0
    manual = 0
    urgent = []

    for pi in intents(s, since, args.max_intents):
        state, detail = classify(pi, now, args.warn_hours * 3600)
        if state == "automatic":
            continue
        manual += 1
        counts[state] = counts.get(state, 0) + 1
        if state == "lost":
            lost_amount += pi.get("amount") or 0
        if state in ("expiring", "expired", "unknown"):
            urgent.append((pi, state, detail))

    # Soonest deadline first: two intents created the same minute can have very
    # different windows, so age is the wrong sort key.
    def deadline(row):
        charge = row[0].get("latest_charge")
        card = ((charge or {}).get("payment_method_details") or {}).get("card") or {}
        return card.get("capture_before") or 0

    for pi, state, detail in sorted(urgent, key=deadline):
        log.warning("%s  %-9s %s", pi.get("id", "pi_?"), state, detail)

    log.info("%d manual-capture intent(s): %d captured, %d held, %d expiring, "
             "%d lost", manual, counts.get("captured", 0), counts.get("held", 0),
             counts.get("expiring", 0) + counts.get("expired", 0),
             counts.get("lost", 0))

    if counts.get("expiring") or counts.get("expired"):
        log.warning("  repair: capture now, oldest deadline first:")
        log.warning("  POST %s/payment_intents/{id}/capture", API)
    if counts.get("lost"):
        log.warning("  %d authorization(s) already expired, %d minor unit(s) "
                    "never collected. Each one also produced a refund with "
                    "reason expired_uncaptured_charge.",
                    counts["lost"], lost_amount)
        log.warning("  repair: drive the capture job from capture_before rather "
                    "than a fixed delay, or request extended authorization, or "
                    "let Stripe capture near expiry.")
    return 1 if (counts.get("expiring") or counts.get("expired")
                 or counts.get("lost") or counts.get("unknown")) else 0


if __name__ == "__main__":
    sys.exit(main())
