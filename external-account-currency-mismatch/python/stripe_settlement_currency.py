"""Report connected accounts with no external account able to settle their balance.

Read only. Three kinds of GET and no writes: give this a RESTRICTED key with read
access to Connected accounts and External accounts. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_settlement_currency")

API = "https://api.stripe.com/v1"


def verdict(account, external_accounts, spec=None):
    """Classify one account's settlement path. Pure, so the order is testable.

    `spec` is the platform's country spec, or None to skip the corridor checks.
    Returns (state, detail). The corridor is checked first on purpose: when the
    route is not supported, the currency is not what is wrong and no external
    account will fix it, so reporting a currency mismatch there is misleading.
    """
    country = account.get("country")
    currency = (account.get("default_currency") or "").lower()
    accounts = external_accounts or []

    if not currency:
        return ("unknown", "the account has no default_currency to settle in")

    if spec:
        transferable = spec.get("supported_transfer_countries")
        if transferable is not None and country not in transferable:
            return ("unsupported-corridor",
                    "%s is not in this platform's supported_transfer_countries; no "
                    "bank account of any currency makes this payout legal" % country)
        bankable = spec.get("supported_bank_account_currencies")
        if bankable is not None and country not in (bankable.get(currency) or []):
            return ("unbankable-currency",
                    "a bank account in %s cannot hold %s under this country spec"
                    % (country, currency.upper()))

    if not accounts:
        return ("no-destination",
                "no external account at all, so no payout is ever attempted")

    matching = [e for e in accounts
                if (e.get("currency") or "").lower() == currency]
    if not matching:
        held = sorted({(e.get("currency") or "?").lower() for e in accounts})
        return ("currency-missing",
                "settles in %s but the only destination(s) are %s"
                % (currency.upper(), ", ".join(c.upper() for c in held)))
    if not any(e.get("default_for_currency") for e in matching):
        return ("not-default",
                "a %s destination exists but none is default_for_currency, so "
                "automatic payouts have no target" % currency.upper())
    return ("settles", "%s destination present and default_for_currency" % currency.upper())


def get(session, path, account=None, **params):
    headers = {"Stripe-Account": account} if account else None
    r = session.get(API + path, params=params, headers=headers, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def paginate(session, path, limit):
    """Walk a list endpoint, stopping once `limit` objects have been yielded."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
            if seen >= limit:
                return
        if not page.get("has_more") or not data:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=500,
                    help="stop after this many connected accounts")
    ap.add_argument("--skip-country-spec", action="store_true",
                    help="skip the corridor checks and only compare currencies")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    spec = None
    if not args.skip_country_spec:
        platform = get(s, "/account")
        spec = get(s, "/country_specs/%s" % platform.get("country", "US"))
        log.info("platform in %s, %d transfer country/countries supported",
                 platform.get("country"),
                 len(spec.get("supported_transfer_countries") or []))

    total = settling = blocked = 0
    for acct in paginate(s, "/accounts", args.max_accounts):
        total += 1
        externals = get(s, "/accounts/%s/external_accounts" % acct["id"],
                        limit=100).get("data", [])
        state, detail = verdict(acct, externals, spec)
        line = "%-21s %s  %s" % (state, acct["id"], detail)
        if state == "settles":
            settling += 1
            continue
        blocked += 1
        log.warning(line)
        if state == "not-default":
            log.warning("  repair: POST %s/accounts/%s/external_accounts/{ba_id} with "
                        "default_for_currency=true", API, acct["id"])
        elif state in ("currency-missing", "no-destination", "unbankable-currency"):
            log.warning("  repair: POST %s/accounts/%s with an external_account token "
                        "in %s, then flag it default_for_currency=true",
                        API, acct["id"], (acct.get("default_currency") or "?").upper())
        elif state == "unsupported-corridor":
            log.warning("  repair: none by API. Move this recipient to Global Payouts "
                        "or a locally acquiring platform account.")

    log.info("%d account(s): %d settling, %d blocked", total, settling, blocked)
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
