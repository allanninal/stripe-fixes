"""Report EU business invoices billed with VAT because no tax ID was on file.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Invoices and Customers. The repair is printed, never performed, because
a credit note is a legal record and reissuing an invoice rebills a customer.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_eu_vat_ids")

API = "https://api.stripe.com/v1"

# The 27 member states. Reverse charge is an intra-EU mechanism, so a country
# outside this set is a different question with a different answer.
EU = frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL "
               "PT RO SK SI ES SE".split())

# Verification results that are not a confirmation. `pending` is normal for a few
# minutes and a problem after a few months.
UNCONFIRMED = ("unverified", "unavailable", "pending")


def verdict(country, invoice_tax_ids, tax_exempt, tax_amount, verification):
    """Classify one paid invoice. Pure, so the rules can be tested without a network.

    `invoice_tax_ids` is the invoice's customer_tax_ids array, frozen at
    finalization. `tax_exempt` is customer_tax_exempt. `tax_amount` is the tax
    actually charged in minor units. `verification` is the status of the
    customer's tax ID, or None when there is not one. Returns (state, detail).
    """
    if country not in EU:
        return ("out-of-scope",
                "%s is outside the EU: the reverse charge does not apply here"
                % (country or "no country on the invoice",))
    if tax_exempt == "reverse":
        return ("reverse-charge",
                "billed under the reverse charge; the buyer accounts for the VAT")
    if tax_exempt == "exempt":
        return ("exempt",
                "recorded as exempt, so no VAT was due and none was charged")
    if not invoice_tax_ids:
        if tax_amount:
            return ("charged-vat",
                    "no customer_tax_ids on the invoice and %d in tax charged: a "
                    "business was billed as a consumer" % tax_amount)
        return ("no-id-no-vat",
                "no tax ID and no VAT either; that is a registration question "
                "rather than a reverse charge one")
    if verification in UNCONFIRMED:
        return ("unverified",
                "a tax ID is on the invoice but its verification status is %r: "
                "not a number to rely on" % (verification,))
    return ("ok", "a verified tax ID is recorded on the invoice")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def paid_invoices(session, days, limit):
    """Page paid invoices created within the window."""
    cutoff = int(time.time() - days * 86400)
    out = []
    params = {"status": "paid", "limit": 100, "created[gte]": cutoff}
    while True:
        page = get(session, "/invoices", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def verification_status(session, customer_id, cache):
    """Weakest verification status across a customer's tax IDs, or None."""
    if customer_id in cache:
        return cache[customer_id]
    status = None
    try:
        ids = get(session, "/customers/%s/tax_ids" % customer_id,
                  limit=10).get("data", [])
    except requests.HTTPError:
        ids = []
    for tid in ids:
        s = (tid.get("verification") or {}).get("status")
        if s in UNCONFIRMED:
            status = s
            break
        status = status or s
    cache[customer_id] = status
    return status


def tax_charged(inv):
    """Total tax on the invoice in minor units, across every tax line."""
    return sum(t.get("amount") or 0 for t in (inv.get("total_taxes") or []))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=float, default=180,
                    help="how far back to read paid invoices")
    ap.add_argument("--top", type=int, default=20,
                    help="how many invoices to print")
    ap.add_argument("--max-invoices", type=int, default=5000,
                    help="stop paginating after this many invoices")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    cache = {}
    eu_seen = 0
    findings = []
    for inv in paid_invoices(s, args.days, args.max_invoices):
        country = ((inv.get("customer_address") or {}).get("country") or "")
        if country not in EU:
            continue
        eu_seen += 1
        cus = inv.get("customer")
        if isinstance(cus, dict):
            cus = cus.get("id")
        ids = inv.get("customer_tax_ids") or []
        verification = verification_status(s, cus, cache) if ids and cus else None
        state, detail = verdict(country, ids, inv.get("customer_tax_exempt"),
                                tax_charged(inv), verification)
        if state in ("charged-vat", "unverified", "no-id-no-vat"):
            findings.append((state, inv.get("id", "<no id>"), cus, country,
                             tax_charged(inv), detail))

    if not findings:
        log.info("%-13s 0 of %d EU invoice(s) billed to a business as a consumer",
                 "clear", eu_seen)
        return 0

    charged = [f for f in findings if f[0] == "charged-vat"]
    log.warning("%-13s %d of %d EU invoice(s) flagged, %d charged VAT with no "
                "tax ID, %d in minor units", "no-tax-id", len(findings), eu_seen,
                len(charged), sum(f[4] for f in charged))

    findings.sort(key=lambda f: -f[4])
    for state, inv_id, cus, country, tax, detail in findings[:args.top]:
        log.warning("  %-13s %s  %s  %s  %d  %s",
                    state, inv_id, cus, country, tax, detail)
        if state == "charged-vat":
            log.warning("      repair: POST %s/tax_ids  type=eu_vat  "
                        "value=%s123456789  owner[type]=customer  owner[customer]=%s",
                        API, country, cus)
            log.warning("      the invoice itself is frozen: correct it with a "
                        "credit note and a reissue, not an edit")
    if len(findings) > args.top:
        log.warning("  ... and %d more", len(findings) - args.top)
    log.warning("  then switch on tax ID collection in Checkout and allow the "
                "tax_id field in the billing portal, or the list refills")
    return 1


if __name__ == "__main__":
    sys.exit(main())
