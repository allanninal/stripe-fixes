"""Report connected accounts where the card_payments/transfers pair is down.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Connected accounts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_capability_coupling")

API = "https://api.stripe.com/v1"

PAIR = ("card_payments", "transfers")


def verdict(capabilities):
    """Classify the coupled pair on one account. Pure and offline testable.

    Stripe couples card_payments and transfers: where an account has both, either
    one sitting at inactive disables the pair. Returns (state, detail). An account
    that has only one of the two is reported as uncoupled rather than as healthy,
    because the coupling is not what is wrong with it.
    """
    caps = capabilities or {}
    present = [name for name in PAIR if name in caps]
    if len(present) < len(PAIR):
        return ("uncoupled",
                "only %s on this account, so the pair cannot disable itself"
                % (", ".join(present) or "neither capability",))

    inactive = [name for name in PAIR if caps[name] == "inactive"]
    if len(inactive) == len(PAIR):
        return ("coupled-down",
                "both card_payments and transfers are inactive; collect the union "
                "of their requirements, not one list at a time")
    if inactive:
        blocked = [name for name in PAIR if name not in inactive]
        return ("coupled-down",
                "%s is inactive, which disables %s as well; the field you need may "
                "be filed under %s" % (inactive[0], blocked[0], inactive[0]))

    pending = [name for name in PAIR if caps[name] == "pending"]
    if pending:
        return ("coupled-pending",
                "%s is pending verification; nothing to collect until Stripe "
                "finishes with what it already has" % (", ".join(pending),))

    other = [name for name in PAIR if caps[name] != "active"]
    if other:
        return ("unknown",
                "unrecognised status for %s" % (", ".join(
                    "%s=%r" % (name, caps[name]) for name in other),))
    return ("healthy", "both capabilities active")


def union_due(capability_objects):
    """Union currently_due across every capability, keeping who asked for each.

    Returns [(field, [capability, ...]), ...] sorted by field. This is the list to
    submit in one account update: collecting one capability's list at a time
    cannot converge, because the pair stays disabled while either half is.
    """
    owed = {}
    for cap in capability_objects or []:
        name = cap.get("id") or "?"
        req = cap.get("requirements") or {}
        for field in (req.get("past_due") or []) + (req.get("currently_due") or []):
            owed.setdefault(field, set()).add(name)
    return [(field, sorted(owners)) for field, owners in sorted(owed.items())]


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
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
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    total = healthy = down = pending = fields = 0
    for acct in paginate(s, "/accounts", args.max_accounts):
        total += 1
        state, detail = verdict(acct.get("capabilities"))
        if state == "healthy":
            healthy += 1
            continue
        if state == "uncoupled":
            continue
        if state == "coupled-pending":
            pending += 1
            log.info("%-16s %s  %s", state, acct["id"], detail)
            continue
        down += 1
        log.warning("%-16s %s  %s", state, acct["id"], detail)

        caps = get(s, "/accounts/%s/capabilities" % acct["id"]).get("data", [])
        outstanding = union_due(caps)
        fields += len(outstanding)
        for field, owners in outstanding:
            log.warning("    %-42s required by %s", field, ", ".join(owners))
        if outstanding:
            log.warning("  repair: one POST %s/accounts/%s carrying every field above",
                        API, acct["id"])
        else:
            log.warning("  no fields outstanding: check requirements.disabled_reason "
                        "and requirements.errors on each capability")

    log.info("%d account(s): %d healthy, %d coupled down, %d pending, %d field(s) outstanding",
             total, healthy, down, pending, fields)
    return 1 if down else 0


if __name__ == "__main__":
    sys.exit(main())
