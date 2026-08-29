"""Report a Connect platform with no webhook destination scoped to its accounts.

Read only. Two GET requests and no writes: give this a RESTRICTED key with read
access to Webhook Endpoints and Connected accounts. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_connect_webhook_scope")

API = "https://api.stripe.com/v1"

# The two events that only ever come from a connected account. The endpoint
# object does not return whether it was created with connect=true, so a
# subscription to one of these is the closest thing to evidence the API offers:
# their absence proves a gap, their presence only shows somebody meant to.
CONNECT_SIGNALS = ("account.updated", "account.application.deauthorized")


def coverage(endpoints, is_platform):
    """Decide whether connected-account events have anywhere to go. Pure.

    Takes the raw /v1/webhook_endpoints list and whether this account has any
    connected accounts. Returns (state, detail). `inconclusive` is a real answer
    here and not a failure of the check: a wildcard endpoint would receive these
    events if it were Connect scoped, and nothing in the API says whether it is.
    """
    if not is_platform:
        return ("not-a-platform",
                "no connected accounts on this key, so there is no Connect traffic "
                "to scope a destination for")

    enabled = [e for e in endpoints if e.get("status") == "enabled"]
    disabled = len(endpoints) - len(enabled)

    if not enabled:
        return ("no-endpoints",
                "no enabled endpoint in this mode at all (%d disabled): nothing is "
                "being delivered anywhere, connected or otherwise" % disabled)

    subscribed = set()
    wildcards = []
    for e in enabled:
        types = e.get("enabled_events") or []
        if "*" in types:
            wildcards.append(e.get("url") or e.get("id") or "?")
        subscribed.update(types)

    have = [s for s in CONNECT_SIGNALS if s in subscribed]

    if len(have) == len(CONNECT_SIGNALS):
        return ("covered",
                "an enabled endpoint subscribes to %s" % " and ".join(CONNECT_SIGNALS))

    if wildcards and not have:
        return ("inconclusive",
                "%d endpoint(s) subscribe to * and the endpoint object never returns "
                "whether they are Connect scoped: open %s in Workbench and read "
                "whether it listens to your account or to connected accounts"
                % (len(wildcards), wildcards[0]))

    if have:
        missing = [s for s in CONNECT_SIGNALS if s not in subscribed]
        return ("thin",
                "%s is subscribed but %s is not: %s"
                % (have[0], missing[0],
                   "sellers who disconnect keep looking active"
                   if missing[0] == "account.application.deauthorized"
                   else "you see the departures and none of the verification failures"))

    tail = ", and %d disabled endpoint(s) were ignored" % disabled if disabled else ""
    return ("uncovered",
            "no enabled endpoint subscribes to %s%s"
            % (" or ".join(CONNECT_SIGNALS), tail))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def endpoints(session):
    """Return every webhook endpoint, paginated. Usually one page; not always."""
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/webhook_endpoints", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more"):
            return out
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--show-endpoints", action="store_true",
                    help="print every endpoint with its status and subscription count")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    eps = endpoints(s)
    is_platform = bool(get(s, "/accounts", limit=1).get("data"))

    if args.show_endpoints:
        for e in eps:
            log.info("%s  %-8s %3d event type(s)  %s",
                     e.get("id", "we_?"), e.get("status", "?"),
                     len(e.get("enabled_events") or []), e.get("url", ""))

    state, detail = coverage(eps, is_platform)
    log.info("%d endpoint(s), %s: %s",
             len(eps), "platform with connected accounts" if is_platform
             else "no connected accounts", state)

    if state in ("covered", "not-a-platform"):
        log.info("  %s", detail)
        return 0

    log.warning("  %s", detail)
    log.warning("  repair: create a second destination scoped to connected accounts:")
    log.warning("  POST %s/webhook_endpoints with connect=true, "
                "url=https://<yourdomain>/stripe/connect-webhook", API)
    log.warning("  enabled_events[]=account.updated "
                "enabled_events[]=account.application.deauthorized "
                "enabled_events[]=capability.updated "
                "enabled_events[]=person.updated "
                "enabled_events[]=payout.failed")
    log.warning("  in Workbench: Create an event destination, then Connected accounts")
    log.warning("  then: read the top-level account property on each event and make "
                "any follow-up call as that account")
    return 1


if __name__ == "__main__":
    sys.exit(main())
