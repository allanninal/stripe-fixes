"""Report Stripe webhook endpoints pinned to an outdated api_version.

Read only. One GET and no writes: give this a RESTRICTED key with read access
to Webhook Endpoints. The migration is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import re
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_endpoint_api_version")

API = "https://api.stripe.com/v1"

CURRENT_LINE = "2025-09-30"  # Clover
ACACIA = "2024-09-30"        # every line from here on carried breaking changes
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def verdict(api_version, current_line=CURRENT_LINE):
    """Classify one endpoint's pin. Pure, so the string handling can be tested.

    `api_version` is the raw field: None or "" for an unpinned endpoint, else
    something like "2024-09-30.acacia". Returns (state, detail).
    """
    if api_version is None or api_version == "":
        return ("unpinned",
                "no api_version: events render at the account default, which "
                "moves under this endpoint whenever the account is upgraded")
    m = DATE.match(str(api_version))
    if not m:
        return ("unreadable",
                "api_version %s has no YYYY-MM-DD prefix to compare"
                % str(api_version))
    date = m.group(1)
    if date < ACACIA:
        return ("ancient",
                "pinned to %s, before the %s Acacia line. Typed SDKs deserialize "
                "this into empty objects without throwing." % (date, ACACIA))
    if date < current_line:
        return ("stale",
                "pinned to %s, behind the current %s line. Check the changelog "
                "for the fields your handler reads." % (date, current_line))
    return ("current", "pinned to %s, on the current line" % date)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def endpoints(session):
    """Every webhook endpoint in this key's mode, paginated."""
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/webhook_endpoints", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more"):
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--current-line", default=CURRENT_LINE,
                    help="the release line your SDK targets, as YYYY-MM-DD")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    eps = endpoints(s)
    if not eps:
        log.info("no webhook endpoints configured for this key's mode")
        return 0

    bad = 0
    for ep in eps:
        state, detail = verdict(ep.get("api_version"), args.current_line)
        line = "%-10s %s  %s" % (state, ep.get("url", "?"), detail)
        if state == "current":
            log.info(line)
            continue
        if state == "unpinned":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        log.warning("  api_version is not updatable: POST %s/webhook_endpoints/%s "
                    "accepts only url, enabled_events, description, metadata, disabled",
                    API, ep["id"])
        log.warning("  migrate instead: create a second endpoint on the same url "
                    "with a distinguishing query param and api_version=%s, keeping "
                    "enabled_events identical", args.current_line)
        log.warning("  then, once the new shape is handled: POST %s/"
                    "webhook_endpoints/%s -d disabled=true", API, ep["id"])

    log.info("%d endpoint(s), %d on an outdated pin", len(eps), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
