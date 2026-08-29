"""Report Stripe PaymentIntents abandoned at the authentication step.

Read only. One paginated GET, no writes: give this a RESTRICTED key with read
access to PaymentIntents. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_requires_action")

API = "https://api.stripe.com/v1"
STALE_SECONDS = 24 * 3600


def classify(intent, now, stale_after=STALE_SECONDS):
    """Classify one PaymentIntent. Pure, so the rules can be tested without a network.

    Returns (state, detail). `now` is a unix timestamp passed in rather than read
    here, so the ageing rule can be tested against a pinned clock.
    """
    status = intent.get("status")
    if status != "requires_action":
        return ("other", "status %r, not waiting on authentication" % (status,))
    created = intent.get("created")
    if not isinstance(created, int):
        return ("unknown", "no created timestamp, so the intent cannot be aged")
    action = (intent.get("next_action") or {}).get("type")
    if not action:
        return ("no-next-action",
                "requires_action with an empty next_action: the client was never "
                "told what to do, so nothing can finish this")
    hours = int((now - created) // 3600)
    if now - created < stale_after:
        return ("in-flight",
                "%s, %dh old, still inside the window a customer plausibly needs"
                % (action, hours))
    return ("abandoned",
            "%s, %dh old: the customer left the authentication step and never came back"
            % (action, hours))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payment_intents(session, since, cap):
    """Yield PaymentIntents created since `since`, newest first, up to `cap`."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/payment_intents", **params)
        data = page.get("data", [])
        for pi in data:
            yield pi
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
    ap.add_argument("--stale-hours", type=int, default=24,
                    help="age at which requires_action counts as abandoned")
    ap.add_argument("--max-intents", type=int, default=5000,
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
    stale_after = args.stale_hours * 3600

    counts = {}
    by_action = {}
    examples = []
    scanned = 0

    for pi in payment_intents(s, since, args.max_intents):
        scanned += 1
        state, detail = classify(pi, now, stale_after)
        counts[state] = counts.get(state, 0) + 1
        if state in ("abandoned", "no-next-action"):
            action = (pi.get("next_action") or {}).get("type") or "none"
            by_action[action] = by_action.get(action, 0) + 1
            if len(examples) < 10:
                examples.append((pi["id"], detail))

    abandoned = counts.get("abandoned", 0)
    in_flight = counts.get("in-flight", 0)
    headless = counts.get("no-next-action", 0)

    for pid, detail in examples:
        log.warning("%s  %s", pid, detail)

    log.info("scanned %d intent(s): %d abandoned, %d in-flight, %d with no next_action",
             scanned, abandoned, in_flight, headless)

    if by_action:
        for action, n in sorted(by_action.items(), key=lambda kv: -kv[1]):
            log.warning("  %-24s %d", action, n)

    waiting = abandoned + in_flight
    if waiting:
        # Not the true abandonment rate: Stripe does not report which succeeded
        # intents passed through requires_action on their way, so the honest
        # denominator here is the intents sitting at the step right now.
        log.info("  %.0f%% of the intents at the authentication step are stalled",
                 100.0 * abandoned / waiting)

    if abandoned or headless:
        log.warning("  repair: handle the returned status on the client, e.g. "
                    "await stripe.confirmPayment({elements, confirmParams: {return_url}})")
        log.warning("  repair: for server-confirmed flows call "
                    "stripe.handleNextAction({clientSecret}) with the returned secret")
        log.warning("  check: request the return_url directly and confirm it "
                    "re-retrieves the intent by client_secret")
        log.warning("  check: stop launching 3DS inside a cross-origin iframe")
        log.warning("  to close out the dead ones: POST %s/payment_intents/{id}/cancel "
                    "-d cancellation_reason=abandoned", API)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
