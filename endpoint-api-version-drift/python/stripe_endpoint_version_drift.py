"""Report Stripe webhook endpoints rendering events at different api_versions.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Webhook Endpoints. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_endpoint_version_drift")

API = "https://api.stripe.com/v1"

# Both spellings of "this endpoint has no pin" collapse here, before anything
# deduplicates. An account with two unpinned endpoints has one shape, not two.
ACCOUNT_DEFAULT = "account default"


def normalise(api_version):
    """Map an endpoint's raw api_version onto the shape it actually renders.

    Pure. Stripe returns None on some unpinned endpoints and "" on others; both
    mean "follow the account default", so both become one sentinel.
    """
    if api_version is None or api_version == "":
        return ACCOUNT_DEFAULT
    return str(api_version)


def base_url(url):
    """The URL without its query string or fragment. Pure.

    The documented dual-endpoint upgrade puts two endpoints on one URL,
    distinguished only by a query parameter, so the query string is exactly what
    has to come off before two endpoints can be recognised as the same one.
    """
    return str(url or "").split("?", 1)[0].split("#", 1)[0]


def verdict(endpoints):
    """Classify a whole account's endpoints. Pure, so both traps are testable.

    `endpoints` is a list of dicts with `url`, `api_version` and `status`.
    Returns (state, detail).
    """
    live = [e for e in endpoints if e.get("status") == "enabled"]
    if not live:
        return ("none",
                "no enabled endpoints in this mode: nothing is being delivered, "
                "so nothing can disagree about a shape")

    versions = sorted({normalise(e.get("api_version")) for e in live})
    if len(versions) == 1:
        return ("consistent",
                "all %d enabled endpoint(s) render at %s" % (len(live), versions[0]))

    by_url = {}
    for e in live:
        by_url.setdefault(base_url(e.get("url")), set()).add(
            normalise(e.get("api_version")))
    shared = sorted(u for u, v in by_url.items() if len(v) > 1)
    if shared:
        return ("migration",
                "%d versions in use (%s), and %s is served at more than one of "
                "them. That is the dual-endpoint upgrade shape, still running: "
                "the handler is being sent every event twice, in two shapes."
                % (len(versions), ", ".join(versions), shared[0]))
    return ("drift",
            "%d versions in use (%s) across %d endpoint(s) on different URLs. "
            "The same event reaches your services in different shapes and only "
            "the ones reading a moved field will fail."
            % (len(versions), ", ".join(versions), len(live)))


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
    ap.add_argument("--show-disabled", action="store_true",
                    help="also list disabled endpoints, which are never counted")
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

    state, detail = verdict(eps)
    for ep in eps:
        if ep.get("status") != "enabled" and not args.show_disabled:
            continue
        log.info("  %-9s %-24s %s", ep.get("status", "?"),
                 normalise(ep.get("api_version")), ep.get("url", "?"))

    if state in ("consistent", "none"):
        log.info("%s  %s", state, detail)
        return 0

    log.warning("%s  %s", state, detail)
    log.warning("  api_version cannot be edited, so the repair is a cutover, not "
                "an update: pick the version every consumer should be on")
    log.warning("  disable the losing endpoint: POST %s/webhook_endpoints/{id} "
                "-d disabled=true", API)
    log.warning("  once nothing depends on it, remove it: DELETE %s/"
                "webhook_endpoints/{id}", API)
    log.warning("  then pin the survivor deliberately rather than leaving it on "
                "the account default, which moves at the next upgrade")
    return 1


if __name__ == "__main__":
    sys.exit(main())
