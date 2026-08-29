"""Report Stripe card charges captured at elevated risk without 3D Secure.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Charges. The Radar rules that repair this are printed, never applied,
because a rule change reprices every payment on the account and this script holds
a credential to a live one.
"""
import argparse
import collections
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_3ds_coverage")

API = "https://api.stripe.com/v1"

# Radar levels where an unauthenticated capture is a finding rather than normal.
ELEVATED = ("elevated", "highest")

# The only result that carries the liability shift.
AUTHENTICATED = "authenticated"

# Mastercard's fraud monitoring penalises merchants at or below this share.
SHARE_FLOOR = 0.10


def classify(charge):
    """Classify one charge. Pure. Returns (state, detail).

    `unprotected` is the finding: Radar scored the payment elevated or higher,
    it was captured, and no authentication happened, so a fraud dispute on it
    has no liability shift to invoke.
    """
    pmd = charge.get("payment_method_details") or {}
    if pmd.get("type") != "card":
        return ("not_card",
                "%s, which authenticates differently or not at all"
                % (pmd.get("type") or "no payment method details",))
    if charge.get("status") != "succeeded":
        return ("not_settled",
                "status is %r, so it cannot be disputed" % (charge.get("status"),))

    risk = (charge.get("outcome") or {}).get("risk_level")
    tds = (pmd.get("card") or {}).get("three_d_secure")

    if tds is None:
        if risk in ELEVATED:
            return ("unprotected",
                    "risk_level %s captured with three_d_secure null. Radar "
                    "flagged it, nothing authenticated it, and the fraud "
                    "liability is yours." % risk)
        return ("no_3ds",
                "risk_level %s, no authentication. Ordinary, but it counts "
                "against the account 3DS share." % (risk or "unknown",))

    result = tds.get("result")
    if result == AUTHENTICATED:
        return ("protected",
                "authenticated; liability for most fraud disputes sits with the issuer")
    if risk in ELEVATED:
        return ("attempted",
                "three_d_secure.result is %r on a %s risk charge. The flow ran "
                "and the issuer did not complete it, so this looks covered and "
                "is not." % (result, risk))
    return ("attempted",
            "three_d_secure.result is %r, which is not an authentication" % (result,))


def coverage(authenticated, card_charges, floor=SHARE_FLOOR):
    """Account-wide 3DS share. Pure. Returns (state, detail).

    Only `authenticated` counts in the numerator: an acknowledged attempt is
    not an authentication, and counting it overstates the share against the
    number the card networks compute.
    """
    if not card_charges:
        return ("no_volume", "no card charges in the window")
    share = authenticated / card_charges
    if share <= floor:
        return ("low",
                "%.1f%% of card charges authenticated, at or below the %.0f%% "
                "where Mastercard fraud monitoring applies"
                % (share * 100, floor * 100))
    return ("ok", "%.1f%% of card charges authenticated" % (share * 100))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def charges(session, since, limit):
    """Yield charges created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(session, "/charges", params)
        data = page.get("data", [])
        for c in data:
            yield c
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


REQUEST_RULE = ("Request 3D Secure if :risk_level: != 'normal' "
                "and :amount_in_usd: > 25")
BLOCK_RULE = ("Block if not :is_3d_secure: and :risk_level: != 'normal' "
              "and not :is_off_session: and :digital_wallet: != 'apple_pay' "
              "and not (:digital_wallet: = 'android_pay' and :has_cryptogram:)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90, help="how far back to read charges")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating after this many charges")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = time.time() - args.days * 86400
    states = collections.Counter()
    card_charges = 0
    authenticated = 0
    findings = []

    for c in charges(s, since, args.max_charges):
        state, detail = classify(c)
        states[state] += 1
        if state == "not_card":
            continue
        if state != "not_settled":
            card_charges += 1
        if state == "protected":
            authenticated += 1
        if state in ("unprotected", "attempted"):
            findings.append((c, state, detail))

    for c, state, detail in findings:
        log.warning("%-12s %s  %s %s  %s", state, c.get("id", "?"),
                    c.get("amount"), (c.get("currency") or "?").upper(), detail)

    share_state, share_detail = coverage(authenticated, card_charges)
    log.info("%d card charge(s): %d unprotected, %d attempted, %d authenticated",
             card_charges, states["unprotected"], states["attempted"], authenticated)
    if share_state == "low":
        log.warning("3DS share: %s", share_detail)
    else:
        log.info("3DS share: %s", share_detail)

    if findings or share_state == "low":
        log.warning("  repair, in Dashboard, Radar, Rules, add both together:")
        log.warning("    %s", REQUEST_RULE)
        log.warning("    %s", BLOCK_RULE)
        log.warning("  the request rule alone lets cards whose issuer will not "
                    "authenticate proceed unauthenticated anyway")
        log.warning("  note that early fraud warnings still arrive on authenticated "
                    "payments and still count toward the Visa VAMP ratio")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
