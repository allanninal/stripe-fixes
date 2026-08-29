"""Report Stripe draft invoices that cannot finalize because Stripe Tax cannot
locate the customer.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Invoices. The repair is printed, never performed, because finalizing an
invoice sends a real bill and disabling tax on one changes what is owed.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_tax_blocked_drafts")

API = "https://api.stripe.com/v1"

TAX_LOCATION_ERROR = "customer_tax_location_invalid"
TAX_DISABLED_FOR_LOCATION = "finalization_requires_location_inputs"

# States that mean a human has to touch the customer record or the invoice.
ACTIONABLE = ("tax-location", "tax-dropped", "needs-address", "tax-failed")


def verdict(error_code, tax_status, disabled_reason, auto_advance):
    """Classify one draft invoice. Pure, so the rules can be tested without a network.

    `error_code` is last_finalization_error.code, `tax_status` is
    automatic_tax.status, `disabled_reason` is automatic_tax.disabled_reason.
    Any of them may be None. Returns (state, detail).
    """
    if error_code == TAX_LOCATION_ERROR:
        return ("tax-location",
                "finalization was attempted and refused: Stripe Tax cannot "
                "resolve this customer's location")
    if disabled_reason == TAX_DISABLED_FOR_LOCATION:
        return ("tax-dropped",
                "Stripe switched automatic tax off so this invoice can finalize; "
                "it will be billed and paid with no tax on it")
    if tax_status == "requires_location_inputs":
        return ("needs-address",
                "the tax calculation cannot run for want of a location; no "
                "finalization attempt has failed yet, but one will")
    if tax_status == "failed":
        return ("tax-failed",
                "the calculation failed on Stripe's side; retry the finalization "
                "before editing the customer")
    if error_code:
        return ("other-error",
                "finalization is failing for a reason that is not tax: %s"
                % (error_code,))
    if not auto_advance:
        return ("not-advancing",
                "auto_advance is false: this draft is outside the collection "
                "workflow rather than blocked by tax")
    return ("clear", "no tax finalization problem recorded on this draft")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def drafts(session, limit):
    """Page every draft invoice. Newest first, as Stripe sends them."""
    out = []
    params = {"status": "draft", "limit": 100}
    while True:
        page = get(session, "/invoices", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def classify(inv):
    """Pull the four fields off an invoice and hand them to verdict()."""
    err = inv.get("last_finalization_error") or {}
    tax = inv.get("automatic_tax") or {}
    return verdict(err.get("code"), tax.get("status"), tax.get("disabled_reason"),
                   bool(inv.get("auto_advance")))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--top", type=int, default=20,
                    help="how many customers to print")
    ap.add_argument("--max-invoices", type=int, default=2000,
                    help="stop paginating after this many drafts")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    seen = 0
    by_customer = {}
    for inv in drafts(s, args.max_invoices):
        seen += 1
        state, detail = classify(inv)
        if state not in ACTIONABLE:
            continue
        cus = inv.get("customer")
        if isinstance(cus, dict):
            cus = cus.get("id")
        entry = by_customer.setdefault(cus or "<no customer>",
                                       {"n": 0, "amount": 0, "state": state,
                                        "detail": detail, "first": inv.get("id")})
        entry["n"] += 1
        entry["amount"] += inv.get("amount_due") or 0

    if not by_customer:
        log.info("%-13s 0 of %d draft invoice(s) blocked on tax location",
                 "clear", seen)
        return 0

    at_stake = sum(e["amount"] for e in by_customer.values())
    log.warning("%-13s %d customer(s), %d draft(s), %d in minor units uncollected",
                "tax-blocked", len(by_customer),
                sum(e["n"] for e in by_customer.values()), at_stake)

    ranked = sorted(by_customer.items(), key=lambda kv: -kv[1]["amount"])
    for cus, e in ranked[:args.top]:
        log.warning("  %-13s %s  %d draft(s)  %d  %s",
                    e["state"], cus, e["n"], e["amount"], e["detail"])
        log.warning("      GET %s/customers/%s?expand[]=tax   read "
                    "tax.automatic_tax and tax.location", API, cus)
        log.warning("      repair: POST %s/customers/%s  address[country]=..  "
                    "address[postal_code]=..  tax[validate_location]=immediately",
                    API, cus)
        log.warning("      then: POST %s/invoices/%s/finalize", API, e["first"])
    if len(ranked) > args.top:
        log.warning("  ... and %d more customer(s)", len(ranked) - args.top)
    log.warning("  fix the customer before the invoice; finalizing first either "
                "fails again or bills with no tax on it")
    return 1


if __name__ == "__main__":
    sys.exit(main())
