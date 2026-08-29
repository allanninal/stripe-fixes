"""Report Stripe prices left at tax_behavior unspecified, ranked by how live they are.

Read only. Four GETs, no writes: give this a RESTRICTED key with read access to
Products, Prices and Subscriptions. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_price_tax_behavior")

API = "https://api.stripe.com/v1"


def verdict(tax_behavior, active_subscriptions, product_tax_code, automatic_tax_in_use):
    """Classify one active price. Pure, so the rules can be tested offline.

    `tax_behavior` is the raw field, `active_subscriptions` how many live
    subscriptions bill this price, `product_tax_code` the parent product's
    tax_code or None, and `automatic_tax_in_use` whether any subscription on the
    account has automatic tax on. Returns (state, detail).
    """
    if tax_behavior == "unspecified":
        if automatic_tax_in_use:
            return ("blocking",
                    "unspecified while automatic tax is in use on this account: "
                    "line items on this price cannot be added to an automatic tax "
                    "invoice. %d active subscription(s)." % active_subscriptions)
        if active_subscriptions:
            return ("live",
                    "unspecified with %d active subscription(s). Setting it means "
                    "a replacement price and a migration, not an edit."
                    % active_subscriptions)
        return ("dormant",
                "unspecified with no active subscriptions. Set it now, while it is "
                "still settable and nothing is billing on it.")
    if not product_tax_code:
        return ("no-tax-code",
                "%s, but the product carries no tax_code, so the rate falls back to "
                "the account default." % tax_behavior)
    return ("ready", "%s, product tax code %s" % (tax_behavior, product_tax_code))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def paginate(session, path, **params):
    params = dict(params, limit=params.get("limit", 100))
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for row in data:
            yield row
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def product_tax_codes(session):
    """Map product id to tax_code. The tax code can be a string id or an object."""
    codes = {}
    for prod in paginate(session, "/products", active="true"):
        code = prod.get("tax_code")
        if isinstance(code, dict):
            code = code.get("id")
        codes[prod["id"]] = code
    return codes


def active_subscription_count(session, price_id, cap):
    """Count active subscriptions billing one price, stopping at `cap`.

    The exact number stops mattering above a handful: any non-zero count means a
    replacement price and a migration rather than an edit.
    """
    count = 0
    for _sub in paginate(session, "/subscriptions", price=price_id, status="active"):
        count += 1
        if count >= cap:
            break
    return count


def automatic_tax_in_use(session):
    page = get(session, "/subscriptions", limit=1,
               **{"automatic_tax[enabled]": "true"})
    return bool(page.get("data"))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--subscription-cap", type=int, default=200,
                    help="stop counting subscriptions per price at this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    codes = product_tax_codes(s)
    auto_tax = automatic_tax_in_use(s)
    if auto_tax:
        log.info("automatic tax is enabled on at least one subscription, so an "
                 "unspecified price is an active fault rather than a latent one")

    findings = 0
    total = 0
    for price in paginate(s, "/prices", active="true"):
        total += 1
        behavior = price.get("tax_behavior")
        product = price.get("product")
        if isinstance(product, dict):
            product = product.get("id")
        subs = (active_subscription_count(s, price["id"], args.subscription_cap)
                if behavior == "unspecified" else 0)
        state, detail = verdict(behavior, subs, codes.get(product), auto_tax)

        line = "%-12s %s  %s" % (state, price["id"], detail)
        if state == "ready":
            log.info(line)
            continue

        findings += 1
        log.warning(line)
        if state == "dormant":
            log.warning("  set tax_behavior on this price while it is still "
                        "unspecified; the value is permanent once set")
        elif state in ("live", "blocking"):
            log.warning("  create a replacement price on product %s with the same "
                        "amount, currency and interval plus an explicit "
                        "tax_behavior, migrate the subscriptions with an explicit "
                        "proration decision, then archive %s",
                        product, price["id"])
        else:
            log.warning("  set a tax_code on product %s so the rate stops falling "
                        "back to the account default", product)

    log.info("%d active price(s), %d needing attention", total, findings)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
