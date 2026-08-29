"""Report Stripe invoices where the automatic tax calculation never completed.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Invoices. The repair is printed, never performed, because amending tax
on a customer changes what they owe and a credit note is a legal record.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_tax_location_status")

API = "https://api.stripe.com/v1"

# An invoice past draft has its tax lines frozen; nothing can be recalculated on
# it, only credited.
FINALIZED = ("open", "paid", "uncollectible", "void")

# States where money has already moved with the wrong tax on it.
BILLED = ("billed-untaxed", "billed-unpriced", "frozen")


def verdict(tax_status, disabled_reason, finalized):
    """Classify one invoice's tax calculation. Pure, so it is testable offline.

    `tax_status` is automatic_tax.status, `disabled_reason` is
    automatic_tax.disabled_reason, both possibly None. `finalized` says whether
    the invoice has left draft, which is the point after which the tax on it
    cannot be changed. Returns (state, detail).
    """
    if disabled_reason == "finalization_requires_location_inputs":
        return ("billed-untaxed",
                "automatic tax was switched off at finalization for want of a "
                "location: this invoice went out with no tax and no error")
    if disabled_reason == "finalization_system_error":
        return ("billed-unpriced",
                "Stripe could not calculate at finalization and disabled tax to "
                "let the invoice through")
    if tax_status == "requires_location_inputs":
        if finalized:
            return ("frozen",
                    "the location was not resolvable and the invoice is already "
                    "finalized: the tax on it can no longer be changed")
        return ("blocked",
                "the calculation cannot run for want of a location; still a "
                "draft, so fixing the customer is enough")
    if tax_status == "failed":
        return ("failed",
                "the calculation failed on Stripe's side; retry before assuming "
                "the customer record is wrong")
    if tax_status == "complete":
        return ("complete",
                "the calculation ran; zero tax here is a registration question, "
                "not a location one")
    return ("unknown", "unrecognised automatic_tax.status %r" % (tax_status,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def invoices_since(session, days, limit):
    """Page invoices created within the window, every status."""
    cutoff = int(time.time() - days * 86400)
    out = []
    params = {"limit": 100, "created[gte]": cutoff}
    while True:
        page = get(session, "/invoices", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=float, default=90,
                    help="how far back to read invoices")
    ap.add_argument("--top", type=int, default=20,
                    help="how many customers to print")
    ap.add_argument("--max-invoices", type=int, default=5000,
                    help="stop paginating after this many invoices")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    seen = 0
    by_customer = {}
    for inv in invoices_since(s, args.days, args.max_invoices):
        seen += 1
        tax = inv.get("automatic_tax") or {}
        if not tax.get("enabled"):
            continue
        state, detail = verdict(tax.get("status"), tax.get("disabled_reason"),
                                inv.get("status") in FINALIZED)
        if state in ("complete", "unknown"):
            continue
        cus = inv.get("customer")
        if isinstance(cus, dict):
            cus = cus.get("id")
        entry = by_customer.setdefault(cus or "<no customer>",
                                       {"n": 0, "amount": 0, "billed": 0,
                                        "state": state, "detail": detail})
        entry["n"] += 1
        entry["amount"] += inv.get("total") or 0
        if state in BILLED:
            entry["billed"] += 1

    if not by_customer:
        log.info("%-15s 0 of %d invoice(s) with an incomplete tax calculation",
                 "clear", seen)
        return 0

    affected = sum(e["n"] for e in by_customer.values())
    log.warning("%-15s %d customer(s), %d of %d invoice(s), %d in minor units billed",
                "tax-incomplete", len(by_customer), affected, seen,
                sum(e["amount"] for e in by_customer.values()))

    ranked = sorted(by_customer.items(), key=lambda kv: (-kv[1]["billed"], -kv[1]["n"]))
    for cus, e in ranked[:args.top]:
        log.warning("  %-15s %s  %d invoice(s), %d already billed  %s",
                    e["state"], cus, e["n"], e["billed"], e["detail"])
        log.warning("      GET %s/customers/%s?expand[]=tax   expect "
                    "tax.automatic_tax = unrecognized_location", API, cus)
        if e["state"] != "failed":
            log.warning("      repair: POST %s/customers/%s  address[country]=..  "
                        "address[postal_code]=..  tax[validate_location]=immediately",
                        API, cus)
    if len(ranked) > args.top:
        log.warning("  ... and %d more customer(s)", len(ranked) - args.top)
    log.warning("  invoices already finalized keep the tax they were finalized "
                "with; a credit note and a reissue is the only correction")
    return 1


if __name__ == "__main__":
    sys.exit(main())
