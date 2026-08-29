"""Report Stripe Checkout Sessions that carry no identifier of your own.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Checkout Sessions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_checkout_reconciliation")

API = "https://api.stripe.com/v1"

DEFAULT_KEYS = ("order_id",)


def verdict(session, expected_keys=DEFAULT_KEYS):
    """Classify one Checkout Session. Pure, so the rules can be tested offline.

    `expected_keys` are the metadata keys your own system reads. Metadata that
    exists but holds none of them is not reconcilable, however full it looks.
    Returns (state, detail).
    """
    ref = str(session.get("client_reference_id") or "").strip()
    meta = session.get("metadata") or {}
    present = [k for k in expected_keys if str(meta.get(k) or "").strip()]

    if ref:
        return ("linked", "client_reference_id=%s" % ref)
    if expected_keys and len(present) == len(expected_keys):
        return ("linked", "metadata carries %s" % ", ".join(present))
    if present:
        missing = [k for k in expected_keys if k not in present]
        return ("partial",
                "metadata has %s but is missing %s"
                % (", ".join(present), ", ".join(missing)))
    if session.get("payment_status") == "paid":
        return ("orphaned",
                "paid, with no client_reference_id and none of %s in metadata: "
                "money that points at nothing" % ", ".join(expected_keys))
    return ("unlinked",
            "no identifier of yours, but payment_status is %r so nothing has "
            "been taken yet" % (session.get("payment_status"),))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def sessions(http, since, limit):
    """Yield Checkout Sessions created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(http, "/checkout/sessions", params)
        data = page.get("data", [])
        for s in data:
            yield s
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to read sessions")
    ap.add_argument("--keys", default=",".join(DEFAULT_KEYS),
                    help="comma-separated metadata keys your system reads")
    ap.add_argument("--max-sessions", type=int, default=5000,
                    help="stop paginating after this many sessions")
    ap.add_argument("--show", type=int, default=10,
                    help="how many orphaned session ids to print")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    expected = tuple(k.strip() for k in args.keys.split(",") if k.strip())
    http = requests.Session()
    http.headers.update({"Authorization": "Bearer " + key})

    counts = {"linked": 0, "partial": 0, "unlinked": 0, "orphaned": 0}
    worst = []
    total = 0
    for s in sessions(http, time.time() - args.days * 86400, args.max_sessions):
        total += 1
        state, detail = verdict(s, expected)
        counts[state] = counts.get(state, 0) + 1
        if state == "orphaned" and len(worst) < args.show:
            worst.append((s.get("id", "?"), detail))

    log.info("%d session(s): %d linked, %d partial, %d unlinked, %d orphaned",
             total, counts["linked"], counts["partial"], counts["unlinked"],
             counts["orphaned"])
    for sid, detail in worst:
        log.warning("orphaned  %s  %s", sid, detail)

    if counts["orphaned"] or counts["partial"]:
        log.warning("  repair: POST %s/checkout/sessions "
                    "-d client_reference_id=<your_order_id> "
                    "-d 'metadata[order_id]=<your_order_id>'", API)
        log.warning("  for Payment Links, set metadata on the link itself: it is "
                    "copied onto every Session the link creates")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
