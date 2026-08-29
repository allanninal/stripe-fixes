"""Report Stripe customers whose cards are still in the legacy sources store.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Customers and PaymentMethods. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_legacy_card_sources")

API = "https://api.stripe.com/v1"

# Cards saved before the PaymentMethods API. `src_` covers the Sources API that
# briefly sat between the two; both live under customer.sources and neither is
# visible to GET /v1/payment_methods.
LEGACY_PREFIXES = ("card_", "src_")


def classify(customer, sources, payment_methods):
    """Sort one customer by which card store actually holds their card.

    Pure, so the states can be tested without a network. `sources` is the data
    array from GET /v1/customers/{id}/sources?object=card and `payment_methods`
    the data array from GET /v1/payment_methods?customer={id}&type=card.

    Returns (state, detail).
    """
    legacy = [s for s in (sources or [])
              if str(s.get("id", "")).startswith(LEGACY_PREFIXES)]
    modern = list(payment_methods or [])
    default_source = customer.get("default_source")
    default_pm = (customer.get("invoice_settings") or {}).get("default_payment_method")

    if not legacy and modern:
        if not default_pm:
            return ("no_default",
                    "%d PaymentMethod(s) and no invoice_settings."
                    "default_payment_method: Billing has nothing to fall back to"
                    % len(modern))
        return ("modern", "%d PaymentMethod(s), modern default set" % len(modern))

    if not legacy and not modern:
        return ("cardless",
                "no card in either store: this is the other cause of "
                "'cannot charge a customer that has no active card'")

    if legacy and not modern:
        if default_source:
            return ("split_brain",
                    "%d legacy source(s) and default_source set, but no "
                    "PaymentMethod at all: every modern code path sees this "
                    "customer as having no card" % len(legacy))
        return ("legacy_only",
                "%d legacy source(s) and no PaymentMethod: charged only by code "
                "that still reads customer.sources" % len(legacy))

    if not default_pm:
        return ("split_default",
                "%d legacy source(s) alongside %d PaymentMethod(s), but "
                "default_payment_method is null: Billing falls back to "
                "default_source and renews on the legacy card"
                % (len(legacy), len(modern)))

    return ("residue",
            "%d legacy source(s) left behind a completed migration: the modern "
            "default is set, so these are safe to remove" % len(legacy))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def customers(session, cap):
    """Yield customers, paginating until Stripe stops or the cap is hit."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/customers", **params)
        data = page.get("data", [])
        for cust in data:
            yield cust
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-customers", type=int, default=5000,
                    help="stop paginating after this many customers")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    counts = {}
    scanned = 0
    for cust in customers(s, args.max_customers):
        scanned += 1
        cid = cust.get("id", "")
        srcs = get(s, "/customers/%s/sources" % cid,
                   object="card", limit=100).get("data", [])

        # Skip the second call for the healthy majority: a customer with no
        # legacy source and a modern default is already migrated, and the
        # PaymentMethod list cannot change that answer.
        default_pm = (cust.get("invoice_settings") or {}).get("default_payment_method")
        pms = []
        if srcs or not default_pm:
            pms = get(s, "/payment_methods",
                      customer=cid, type="card", limit=100).get("data", [])

        state, detail = classify(cust, srcs, pms)
        counts[state] = counts.get(state, 0) + 1
        if state != "modern":
            log.warning("%s  %-14s %s", cid or "cus_?", state, detail)

    split = counts.get("split_brain", 0) + counts.get("split_default", 0)
    legacy_only = counts.get("legacy_only", 0)
    cardless = counts.get("cardless", 0)

    log.info("%d customer(s): %d modern, %d legacy-only, %d split, %d cardless",
             scanned, counts.get("modern", 0), legacy_only, split, cardless)

    if legacy_only or split or counts.get("residue"):
        log.warning("  repair, in this order, per customer:")
        log.warning("  1. create a PaymentMethod from the legacy card, or send "
                    "the customer through a SetupIntent to re-add it")
        log.warning("  2. POST %s/customers/{id} with "
                    "invoice_settings[default_payment_method]=pm_...", API)
        log.warning("  3. only then remove the old object at "
                    "%s/customers/{id}/sources/{card_id}", API)
    if cardless:
        log.warning("  %d customer(s) have no card in either store: a SetupIntent "
                    "is the only repair, and it collects the mandate too", cardless)
    bad = scanned - counts.get("modern", 0)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
