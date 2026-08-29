"""Report Stripe charges captured after an AVS or CVC check came back failed.

Read only. One account read and one paginated GET: give this a RESTRICTED key
with read access to Account and Charges. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_avs_cvc_checks")

API = "https://api.stripe.com/v1"

CHECK_FIELDS = ("cvc_check", "address_postal_code_check", "address_line1_check")
INCONCLUSIVE = (None, "unavailable", "unchecked")


def _covered(field, decline_on):
    """True when the account is configured to decline on this check failing."""
    settings = decline_on or {}
    if field == "cvc_check":
        return bool(settings.get("cvc_failure"))
    return bool(settings.get("avs_failure"))


def verdict(checks, captured, decline_on):
    """Classify one charge's verification result. Pure, so it tests offline.

    `checks` is payment_method_details.card.checks, or None when the charge was
    not a card payment. `decline_on` is settings.card_payments.decline_on from
    the account. Returns (state, detail).
    """
    if checks is None:
        return ("not_card", "no card checks on this charge")
    values = {f: checks.get(f) for f in CHECK_FIELDS}
    if all(v is None for v in values.values()):
        return ("uncollected",
                "no AVS or CVC result at all: the details were never collected, so "
                "there was nothing for the issuer to verify")
    failed = sorted(f for f, v in values.items() if v == "fail")
    if failed and captured:
        uncovered = [f for f in failed if not _covered(f, decline_on)]
        if uncovered:
            return ("captured_on_fail",
                    "%s failed and the charge was captured: decline_on is not set "
                    "for %s" % (", ".join(failed), ", ".join(uncovered)))
        return ("captured_despite_setting",
                "%s failed and the charge was captured even though decline_on "
                "covers it: check the Radar rules are enabled" % ", ".join(failed))
    if failed:
        return ("held",
                "%s failed and the charge is not captured: this is still a decision "
                "you can make" % ", ".join(failed))
    if any(values[f] in INCONCLUSIVE for f in CHECK_FIELDS):
        missing = sorted(f for f in CHECK_FIELDS if values[f] in INCONCLUSIVE)
        return ("unverified", "no usable result for %s" % ", ".join(missing))
    return ("verified", "every collected check passed")


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


def card_checks(charge):
    """payment_method_details.card.checks, or None when this is not a card."""
    details = charge.get("payment_method_details") or {}
    if details.get("type") != "card":
        return None
    return (details.get("card") or {}).get("checks")


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

    account = get(s, "/account")
    settings = account.get("settings") or {}
    decline_on = (settings.get("card_payments") or {}).get("decline_on") or {}
    log.info("decline_on: avs=%s cvc=%s",
             bool(decline_on.get("avs_failure")), bool(decline_on.get("cvc_failure")))

    since = int(time.time() - args.days * 86400)
    charges = page(s, "/charges", args.max_charges, **{"created[gte]": since})

    counts = {}
    flagged = []
    cards = 0
    for ch in charges:
        checks = card_checks(ch)
        if checks is None and (ch.get("payment_method_details") or {}).get("type") != "card":
            continue
        cards += 1
        state, detail = verdict(checks, ch.get("captured"), decline_on)
        counts[state] = counts.get(state, 0) + 1
        if state in ("captured_on_fail", "captured_despite_setting", "held"):
            flagged.append((ch, state, detail))

    log.info("%d card charge(s): %d captured on a failed check, %d never collected",
             cards,
             counts.get("captured_on_fail", 0) + counts.get("captured_despite_setting", 0),
             counts.get("uncollected", 0))

    for ch, state, detail in flagged:
        log.warning("%-24s %s %s", state, ch.get("id"), detail)

    if not flagged and not counts.get("uncollected"):
        return 0

    if flagged:
        log.warning("  enable the risk-scored built-ins in Dashboard, Radar, Rules: "
                    "postal code verification fails based on risk score, and CVC "
                    "verification fails based on risk score")
    if counts.get("uncollected"):
        log.warning("  %d charge(s) had no checks at all. Collect the details: set "
                    "billing_address_collection to required on Checkout Sessions, or "
                    "collect the postal code in the Payment Element.",
                    counts["uncollected"])
    return 1


if __name__ == "__main__":
    sys.exit(main())
