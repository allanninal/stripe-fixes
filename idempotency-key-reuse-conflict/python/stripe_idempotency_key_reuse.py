"""Report Stripe idempotency keys reused across more than one request.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Events. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import re
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_idempotency_key_reuse")

API = "https://api.stripe.com/v1"

# Stripe prunes saved idempotency results after roughly 24 hours. A key seen
# either side of that gap was not replayed; it started a new operation.
PRUNE_WINDOW = 86400
MAX_KEY_LEN = 255

OBJECT_ID = re.compile(r"^(cus_|pi_|ch_|sub_|in_|seti_|user[-_])", re.I)
UUID4 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def key_shape(key):
    """What a key string is built out of. Pure.

    Returns (shape, description). Anything but "uuid" and "opaque" is derived
    from something that comes round again, whether or not it has collided yet.
    """
    if key is None or key == "":
        return ("missing", "no key at all")
    k = str(key)
    if len(k) > MAX_KEY_LEN:
        return ("over-long",
                "%d characters, over the %d limit" % (len(k), MAX_KEY_LEN))
    if "@" in k:
        return ("personal",
                "an email address, which repeats and should not be sent as a key")
    if UUID4.match(k):
        return ("uuid", "a v4 uuid")
    if OBJECT_ID.match(k):
        return ("object-id", "an object id, which repeats every time that object "
                             "is used again")
    if k.isdigit():
        return ("integer", "a bare integer, which repeats")
    if ISO_DATE.match(k):
        return ("date", "a date, which repeats for every operation that day")
    return ("opaque", "not obviously derived from anything that repeats")


def verdict(key, request_ids, spread_seconds):
    """Classify one key's tally. Pure, so the thresholds can be tested.

    `request_ids` is the number of distinct request ids carrying this key, and
    `spread_seconds` the gap between its first and last event.
    """
    shape, described = key_shape(key)
    if request_ids > 1 and spread_seconds > PRUNE_WINDOW:
        return ("pruned",
                "%d distinct requests, %d seconds apart. Stripe forgets a key "
                "after about %d seconds, so the later one started a fresh "
                "operation and created a duplicate rather than replaying."
                % (request_ids, spread_seconds, PRUNE_WINDOW))
    if request_ids > 1:
        return ("concurrent",
                "%d distinct requests inside the window Stripe remembers the "
                "key. Both executed, so the key is shared between operations "
                "rather than unique to one. Under load this returns 409 "
                "idempotency_key_in_use." % request_ids)
    if shape not in ("uuid", "opaque"):
        return ("derived",
                "one request so far, but the key is %s" % described)
    return ("unique", "one request, and the key is %s" % described)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def keys_seen(session, since, limit):
    """Per-key distinct request ids and the timestamp spread. Keyed requests only."""
    seen = {}
    total = 0
    params = {"limit": 100, "created[gte]": int(since)}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            total += 1
            req = ev.get("request")
            if not isinstance(req, dict):
                continue  # Stripe-initiated, or an old bare-string request field
            key = req.get("idempotency_key")
            if not key:
                continue  # unkeyed requests are a different problem
            row = seen.setdefault(key, {"ids": set(), "first": None, "last": None})
            if req.get("id"):
                row["ids"].add(req["id"])
            created = ev.get("created")
            if created is not None:
                row["first"] = created if row["first"] is None else min(row["first"], created)
                row["last"] = created if row["last"] is None else max(row["last"], created)
        if not data or not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return seen, total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to sample, up to the 30-day retention limit")
    ap.add_argument("--max-events", type=int, default=5000,
                    help="stop paginating after this many events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = time.time() - args.days * 86400
    seen, total = keys_seen(s, since, args.max_events)
    log.info("sampled %d event(s) over %d day(s)", total, args.days)

    reused = derived = 0
    for k in sorted(seen):
        row = seen[k]
        spread = (row["last"] or 0) - (row["first"] or 0)
        state, detail = verdict(k, len(row["ids"]) or 1, spread)
        if state == "unique":
            continue
        line = "%-11s %-40s %s" % (state, k[:40], detail)
        if state == "derived":
            derived += 1
            log.info(line)
        else:
            reused += 1
            log.warning(line)

    if reused or derived:
        log.warning("  repair: one fresh v4 uuid per logical operation, made when "
                    "the operation is first attempted")
        log.warning("  persist it next to the operation record and resend it "
                    "unchanged for every retry of that exact request")
        log.warning("  on 409 idempotency_key_in_use, back off and retry with the "
                    "same key rather than minting a new one")
        log.warning("  never derive a key from a customer id, an order id, a date "
                    "or an email address; keys cap at %d characters", MAX_KEY_LEN)
    log.info("%d key(s) sampled, %d reused, %d derived from something that repeats",
             len(seen), reused, derived)
    return 1 if reused else 0


if __name__ == "__main__":
    sys.exit(main())
