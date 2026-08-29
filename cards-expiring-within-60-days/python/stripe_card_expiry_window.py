"""Report saved Stripe cards expiring within the next 60 days.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Subscriptions, Customers and PaymentMethods. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import datetime as dt
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_card_expiry_window")

API = "https://api.stripe.com/v1"

WINDOW_DAYS = 60      # how far ahead to look
NUDGE_DAYS = 45       # when to send the first email
# Wallet-backed credentials are network tokens: the issuer reissues them along
# with the card, so their printed expiry date is not a churn event.
TOKENISED_WALLETS = ("apple_pay", "google_pay", "link", "samsung_pay")


def expires_at(exp_month, exp_year):
    """Unix seconds at which a card stops being valid.

    A card is good through the END of its expiry month, so the instant it dies is
    the start of the following month. December rolls the year over explicitly
    rather than relying on month 13 normalising the way you hope.
    """
    month, year = int(exp_month), int(exp_year)
    if month == 12:
        month, year = 1, year + 1
    else:
        month += 1
    return int(dt.datetime(year, month, 1, tzinfo=dt.timezone.utc).timestamp())


def verdict(days_left, is_default=False, wallet=None):
    """Classify one saved card. Pure, so the boundaries can be tested offline.

    `days_left` is None when the PaymentMethod carries no usable expiry.
    Returns (state, detail).
    """
    if days_left is None:
        return ("unreadable", "no exp_month/exp_year on this payment method")
    if days_left <= 0:
        return ("expired",
                "already expired%s; this is a decline that has happened, not one "
                "coming" % (" and it is the billing default" if is_default else ""))
    if wallet in TOKENISED_WALLETS:
        return ("tokenised",
                "prints an expiry in %.0f day(s) but is a %s credential, which is "
                "reissued with the card. Do not email this customer."
                % (days_left, wallet))
    if days_left > WINDOW_DAYS:
        return ("ok", "expires in %.0f day(s), outside the %d day window"
                % (days_left, WINDOW_DAYS))
    if is_default:
        return ("urgent",
                "expires in %.0f day(s) and is the billing default: name the renewal "
                "that fails and email the portal link today" % days_left)
    return ("warn",
            "expires in %.0f day(s); the nudge belongs at %d days, before the "
            "decline rather than after it" % (days_left, NUDGE_DAYS))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Yield objects from a paginated list endpoint until `limit` is reached."""
    seen = 0
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=1000,
                    help="stop after this many active subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    flagged = 0
    seen_customers = set()
    for sub in page_all(s, "/subscriptions", args.max_subscriptions,
                        status="active", limit=100):
        cid = sub.get("customer")
        if not cid or cid in seen_customers:
            continue
        seen_customers.add(cid)

        customer = get(s, "/customers/" + cid)
        invoice_settings = customer.get("invoice_settings") or {}
        defaults = {sub.get("default_payment_method"),
                    invoice_settings.get("default_payment_method")}
        defaults.discard(None)

        pms = get(s, "/payment_methods", customer=cid, type="card", limit=100)
        for pm in pms.get("data", []):
            card = pm.get("card") or {}
            if not card.get("exp_month") or not card.get("exp_year"):
                days_left = None
            else:
                days_left = (expires_at(card["exp_month"], card["exp_year"]) - now) / 86400.0
            wallet = (card.get("wallet") or {}).get("type")
            state, detail = verdict(days_left, pm.get("id") in defaults, wallet)

            line = "%-10s %s  %s  %s" % (state, cid, pm.get("id"), detail)
            if state in ("ok", "tokenised"):
                log.info(line)
                continue
            log.warning(line)
            flagged += 1

    if not flagged:
        log.info("clear      no card on an active subscription expires within %d days",
                 WINDOW_DAYS)
        return 0

    log.warning("  %d card(s) need a nudge. Email a portal link, do not wait for "
                "the decline:", flagged)
    log.warning("  POST %s/billing_portal/sessions -d customer=cus_X "
                "-d return_url=https://example.com/billing", API)
    log.warning("  and turn on Smart Retries at "
                "https://dashboard.stripe.com/settings/billing/automatic")
    return 1


if __name__ == "__main__":
    sys.exit(main())
