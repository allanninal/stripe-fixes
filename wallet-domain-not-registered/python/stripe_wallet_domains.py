"""Report domains where Apple Pay, Google Pay, Link or PayPal will not render.

Read only. One GET request, no writes: give this a RESTRICTED key with read
access to Payment Method Domains. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_wallet_domains")

API = "https://api.stripe.com/v1"

WALLETS = ("apple_pay", "google_pay", "link", "paypal")


def dark_wallets(domain):
    """Wallets on this domain that are not active, with Stripe's own reason.

    Pure. Each wallet carries its own status on the domain object, so one domain
    can serve Link happily while Apple Pay is dark. The reason is in
    `<wallet>.status_details.error_message` rather than in the status itself,
    which is why a check that only reads the status has nothing useful to print.
    """
    out = []
    for name in WALLETS:
        w = domain.get(name)
        if not isinstance(w, dict):
            continue
        if w.get("status") != "active":
            details = w.get("status_details") or {}
            out.append((name, w.get("status"),
                        details.get("error_message") or "no reason given"))
    return out


def verdict(domain):
    """Classify one registered domain. Pure. Returns (state, detail, dark).

    livemode is checked before anything else: a healthy test-mode registration
    produces exactly the symptom being investigated and looks correct in the
    test Dashboard, so it cannot be allowed to read as a pass.
    """
    if not domain.get("livemode"):
        return ("test_only",
                "registered in test mode only, which has no effect on live "
                "traffic: live visitors see no wallet at all", [])
    if not domain.get("enabled"):
        return ("disabled",
                "registered but disabled, which filters the wallets out exactly "
                "as if it had never been registered", [])
    dark = dark_wallets(domain)
    if dark:
        return ("dark",
                "%d wallet(s) not active on a live, enabled domain" % len(dark),
                dark)
    return ("active", "every wallet active", [])


def missing_domains(registered, serving):
    """Hosts you serve checkout from that have no registration at all. Pure.

    Registration is per-host, not per-site, so checkout.example.com is invisible
    to Stripe even when example.com beside it is registered and healthy.
    """
    have = {d.get("domain_name") for d in registered}
    return sorted(set(serving) - have)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to " + path)
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--domain", action="append", default=[],
                    help="a host you serve checkout from; repeatable")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2
    if "_live_" not in key:
        log.warning("this is a test-mode key: registrations here say nothing "
                    "about what live visitors see")

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    domains = get(s, "/payment_method_domains", limit=100).get("data", [])
    if not domains:
        log.warning("no payment method domains registered: every wallet is "
                    "filtered out in production")
        log.warning("  repair: POST %s/payment_method_domains -d "
                    "domain_name=checkout.example.com in live mode", API)
        return 1

    bad = 0
    for d in domains:
        state, detail, dark = verdict(d)
        line = "%-9s %s  %s" % (state, d.get("domain_name", "?"), detail)
        if state == "active":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        for name, status, reason in dark:
            log.warning("    %s is %s: %s", name, status, reason)
        if state == "test_only":
            log.warning("  repair: register the same host again with a live key")
        elif state == "disabled":
            log.warning("  repair: POST %s/payment_method_domains/%s -d enabled=true",
                        API, d.get("id"))
        else:
            log.warning("  repair: serve /.well-known/"
                        "apple-developer-merchantid-domain-association from the "
                        "host, then POST %s/payment_method_domains/%s/validate",
                        API, d.get("id"))

    for name in missing_domains(domains, args.domain):
        bad += 1
        log.warning("missing   %s  serves checkout and is not registered at all", name)
        log.warning("  repair: POST %s/payment_method_domains -d domain_name=%s",
                    API, name)

    log.info("%d registered domain(s), %d needing attention", len(domains), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
