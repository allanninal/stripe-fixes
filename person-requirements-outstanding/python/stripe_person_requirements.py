"""Report the Persons whose outstanding requirements are blocking an account.

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
log = logging.getLogger("stripe_person_requirements")

API = "https://api.stripe.com/v1"


def person_ref(entry):
    """Return the Person id an account-level requirement points at, or None.

    Account requirements read like person_1MqEZ.verification.document: the id is
    everything left of the first dot, the rest is the field on that Person. Pure,
    so the parsing is testable without a network. Entries that are ordinary
    account fields come back as None rather than as a bogus id.
    """
    if not isinstance(entry, str) or not entry.startswith("person_"):
        return None
    return entry.split(".", 1)[0]


def verdict(person):
    """Classify one Person object. Pure, so the rules are visible and testable.

    Returns (state, detail). Ordered by what each state costs: a past_due field
    has already disabled something, a currently_due field has not yet, and a
    person Stripe is still reviewing needs nothing collected at all.
    """
    req = person.get("requirements") or {}
    past = req.get("past_due") or []
    due = req.get("currently_due") or []
    status = (person.get("verification") or {}).get("status")

    if past:
        return ("past-due",
                "%d field(s) past due (%s); capabilities that depend on this "
                "person are already off" % (len(past), ", ".join(past)))
    if due:
        return ("blocking",
                "%d field(s) currently due (%s)" % (len(due), ", ".join(due)))
    if status == "pending":
        return ("verifying",
                "submitted and under review; nothing to collect, and a link sent "
                "now opens a form with no fields on it")
    if status == "unverified":
        return ("unverified",
                "not verified and nothing due yet; Stripe asks at a threshold, so "
                "this is the cheap moment to collect it")
    if status == "verified":
        return ("clear", "verified, nothing outstanding")
    return ("unknown", "unrecognised verification status %r" % (status,))


def blocked_on(account):
    """The Person ids the account's own requirements point at, in order seen."""
    req = account.get("requirements") or {}
    out = []
    for entry in (req.get("past_due") or []) + (req.get("currently_due") or []):
        pid = person_ref(entry)
        if pid and pid not in out:
            out.append(pid)
    return out


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


def describe(person):
    """A label a support agent can act on: the role if there is one, else a name."""
    rel = person.get("relationship") or {}
    roles = sorted(k for k, v in rel.items() if v is True)
    name = " ".join(x for x in (person.get("first_name"), person.get("last_name")) if x)
    return "/".join(roles) or name or person.get("id", "?")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=500,
                    help="stop after this many connected accounts")
    ap.add_argument("--show-clear", action="store_true",
                    help="also print the persons with nothing outstanding")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    accounts = people = bad = 0
    for acct in paginate(s, "/accounts", args.max_accounts):
        accounts += 1
        pointed_at = blocked_on(acct)
        for person in paginate(s, "/accounts/%s/persons" % acct["id"], 100):
            people += 1
            state, detail = verdict(person)
            line = "%-10s %s %s (%s)  %s" % (
                state, acct["id"], person["id"], describe(person), detail)
            if state in ("clear", "unverified") and not args.show_clear:
                continue
            if state in ("clear", "verifying", "unverified"):
                log.info(line)
                continue
            bad += 1
            log.warning(line)
            if person["id"] in pointed_at:
                log.warning("  the account's own requirements name this person")
            log.warning("  repair: POST %s/accounts/%s/persons/%s with the field(s) above",
                        API, acct["id"], person["id"])
            log.warning("  for a document, upload it to files.stripe.com with "
                        "purpose=identity_document and set verification[document][front]")

    log.info("%d account(s), %d person(s), %d needing attention", accounts, people, bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
