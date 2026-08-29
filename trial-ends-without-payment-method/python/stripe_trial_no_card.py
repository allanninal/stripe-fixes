"""Report Stripe trials ending soon with no payment method on file.

Read only. GET requests only, no writes: give this a RESTRICTED key with read
access to Subscriptions and Customers. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_trial_no_card")

API = "https://api.stripe.com/v1"

# Stripe fires customer.subscription.trial_will_end three days out, so this is the
# window in which a warning email is still the documented remedy.
HORIZON = 259200

OUTCOMES = {
    "create_invoice": "Stripe invoices on the trial end date, the invoice fails "
                      "immediately, and the subscription drops into past_due",
    "pause": "the subscription moves to paused and stops invoicing, which is "
             "recoverable but earns nothing until someone resumes it",
    "cancel": "the subscription is cancelled outright on the trial end date",
}


def verdict(sub, now, horizon=HORIZON):
    """Classify one trialing subscription. Pure, so the horizon can be tested.

    Checks the three payment-method slots that apply to a trial ending, then reads
    trial_settings.end_behavior.missing_payment_method to say what will happen.
    """
    if sub.get("default_payment_method") or sub.get("default_source"):
        return ("carded", "a payment method resolves, so the trial will convert")
    customer = sub.get("customer")
    if not isinstance(customer, dict):
        return ("unknown",
                "customer was not expanded, so the customer-level default cannot be "
                "read; re-run with expand[]=data.customer")
    settings = customer.get("invoice_settings") or {}
    if settings.get("default_payment_method"):
        return ("carded",
                "falls back to customer.invoice_settings.default_payment_method")

    behaviour = (((sub.get("trial_settings") or {}).get("end_behavior") or {})
                 .get("missing_payment_method") or "create_invoice")
    outcome = OUTCOMES.get(
        behaviour, "end behaviour %r is not one Stripe documents" % (behaviour,))

    trial_end = sub.get("trial_end")
    if not isinstance(trial_end, (int, float)):
        return ("no-card", "no payment method and no trial_end to schedule against")
    remaining = trial_end - now
    if remaining <= horizon:
        return ("imminent",
                "no payment method, trial ends in %.0f h: %s"
                % (remaining / 3600.0, outcome))
    return ("no-card",
            "no payment method, trial ends in %.0f day(s): %s"
            % (remaining / 86400.0, outcome))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_trialing(session, limit):
    """Walk the trialing subscriptions. Read only; every call here is a GET."""
    out = []
    params = {"status": "trialing", "limit": 100, "expand[]": "data.customer"}
    while True:
        page = get(session, "/subscriptions", **params)
        out.extend(page.get("data", []))
        if not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = page["data"][-1]["id"]
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hours", type=int, default=72,
                    help="how far ahead counts as imminent (default 72)")
    ap.add_argument("--max", type=int, default=1000,
                    help="stop after this many subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = page_trialing(s, args.max)
    if not subs:
        log.info("no trialing subscriptions for this key's mode")
        return 0

    now = time.time()
    counts = {}
    for sub in subs:
        state, detail = verdict(sub, now, args.hours * 3600)
        counts[state] = counts.get(state, 0) + 1
        if state == "carded":
            continue
        line = "%-9s %s  %s" % (state, sub.get("id", "?"), detail)
        if state == "no-card":
            log.info(line)
            continue
        log.warning(line)
        customer = sub.get("customer")
        cus_id = customer.get("id") if isinstance(customer, dict) else customer
        log.warning("  repair: email %s a billing-portal link and collect a card "
                    "before %s", cus_id or "the customer", sub.get("trial_end"))
        log.warning("  and choose the end behaviour deliberately: POST "
                    "%s/subscriptions/%s -d "
                    "trial_settings[end_behavior][missing_payment_method]=pause",
                    API, sub.get("id"))

    log.info("%d trialing, %d ending within %dh with no card, %d with no card "
             "further out", len(subs), counts.get("imminent", 0), args.hours,
             counts.get("no-card", 0))
    if counts.get("unknown"):
        log.warning("%d row(s) could not be classified: re-run with the customer "
                    "expanded", counts["unknown"])
    if counts.get("imminent"):
        log.warning("subscribe to customer.subscription.trial_will_end; it fires "
                    "three days out, which is the window this check reports on")
    return 1 if counts.get("imminent") or counts.get("unknown") else 0


if __name__ == "__main__":
    sys.exit(main())
