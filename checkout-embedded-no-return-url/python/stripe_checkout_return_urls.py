"""Report Stripe Checkout Sessions whose return leg has no destination.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Checkout Sessions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_checkout_return_urls")

API = "https://api.stripe.com/v1"

# Methods that take the customer off your page to authenticate. redirect_on_completion
# of "never" disables these outright rather than merely skipping a redirect.
REDIRECT_METHODS = ("ideal", "bancontact", "p24", "sofort", "eps", "giropay", "blik")

# Stripe has spelled the ui_mode values differently across API versions, so accept
# both rather than reporting a pinned older version as unknown.
EMBEDDED_MODES = ("embedded_page", "embedded", "elements")
HOSTED_MODES = ("hosted_page", "hosted")

PLACEHOLDER = "{CHECKOUT_SESSION_ID}"


def verdict(session):
    """Classify one Checkout Session. Pure, so the rules can be tested offline.

    Returns (state, detail).
    """
    ui = session.get("ui_mode") or HOSTED_MODES[0]
    methods = [m for m in (session.get("payment_method_types") or [])
               if m in REDIRECT_METHODS]

    if ui in EMBEDDED_MODES:
        if session.get("redirect_on_completion") == "never" and methods:
            return ("blocked",
                    "redirect_on_completion=never disables redirect-based methods, "
                    "so %s are configured but never offered" % ", ".join(methods))
        if not str(session.get("return_url") or "").strip():
            return ("stranded",
                    "ui_mode=%s with no return_url: a customer who authenticates "
                    "off-site comes back to nowhere" % (ui,))
        return ("ok", "ui_mode=%s with a return_url" % (ui,))

    if ui in HOSTED_MODES:
        success = str(session.get("success_url") or "")
        if PLACEHOLDER not in success:
            return ("unjoinable",
                    "success_url is %s: no %s placeholder, so the landing page "
                    "cannot tell which session it is confirming"
                    % (success or "empty", PLACEHOLDER))
        return ("ok", "hosted, and success_url carries the session id")

    return ("unknown", "unrecognised ui_mode %r" % (ui,))


def get(http, path, params=None):
    r = http.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def sessions(http, since, limit):
    """Yield Checkout Sessions created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(http, "/checkout/sessions", params)
        data = page.get("data", [])
        for s in data:
            yield s
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to read sessions")
    ap.add_argument("--max-sessions", type=int, default=5000,
                    help="stop paginating after this many sessions")
    ap.add_argument("--show", type=int, default=10,
                    help="how many failing session ids to print")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    http = requests.Session()
    http.headers.update({"Authorization": "Bearer " + key})

    tally = {"ok": 0, "stranded": 0, "blocked": 0, "unjoinable": 0, "unknown": 0}
    examples = []
    total = 0
    for s in sessions(http, time.time() - args.days * 86400, args.max_sessions):
        total += 1
        state, detail = verdict(s)
        tally[state] = tally.get(state, 0) + 1
        if state != "ok" and len(examples) < args.show:
            examples.append((state, s.get("id", "?"), detail))

    log.info("%d session(s): %d ok, %d stranded, %d blocked, %d unjoinable",
             total, tally["ok"], tally["stranded"], tally["blocked"],
             tally["unjoinable"])
    for state, sid, detail in examples:
        log.warning("%-10s %s  %s", state, sid, detail)

    if tally["stranded"] or tally["blocked"]:
        log.warning("  repair: POST %s/checkout/sessions -d ui_mode=embedded_page "
                    "-d return_url='https://example.com/after-checkout"
                    "?session_id=%s' -d redirect_on_completion=if_required",
                    API, PLACEHOLDER)
    if tally["unjoinable"]:
        log.warning("  repair: POST %s/checkout/sessions "
                    "-d success_url='https://example.com/thanks?session_id=%s'",
                    API, PLACEHOLDER)

    return 1 if total - tally["ok"] else 0


if __name__ == "__main__":
    sys.exit(main())
