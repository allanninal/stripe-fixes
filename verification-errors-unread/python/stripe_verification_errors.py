"""Report unread requirements.errors on connected accounts, with the fix for each.

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
log = logging.getLogger("stripe_verification_errors")

API = "https://api.stripe.com/v1"

# A new file is required. The same one re-uploaded fails automatically, so the
# instruction has to say what is different about the next capture.
DOCUMENT_CODES = {
    "verification_document_failed_greyscale":
        "the upload was greyscale: a colour scan or photo of the same document",
    "verification_document_not_readable":
        "the image could not be read: re-capture it in focus and uncropped",
    "verification_document_expired":
        "the document is out of date: a current one, not a better scan",
    "verification_document_missing_back":
        "only one side was submitted: the back of the same document",
    "verification_document_failed_other":
        "rejected without a specific cause: a different capture, colour, under "
        "the size limits, and an image rather than a PDF for identity documents",
}

# A new file will never fix these. The typed fields are what disagree.
IDENTITY_CODES = {
    "verification_failed_keyed_identity":
        "the typed name or date of birth does not match the document: correct "
        "the fields, not the file",
}

# Ordinary field edits on the account or person.
FIELD_CODES = {
    "information_missing":
        "a required field was left out: read the requirement and supply it",
    "verification_missing_owners":
        "beneficial owners are missing: add the Person objects for them",
    "invalid_street_address":
        "the address could not be validated: check it against the postal service "
        "format for the country",
    "invalid_tax_id_format":
        "the tax id is not in the format for that country",
}

# The whole invalid_url_website_* family. Matched by prefix because it is long
# and Stripe keeps adding to it.
WEBSITE_PREFIX = "invalid_url_website"

GROUPS = (("document", DOCUMENT_CODES),
          ("identity", IDENTITY_CODES),
          ("field", FIELD_CODES))


def classify(errors):
    """Turn a requirements.errors array into one state and one instruction.

    Pure, so the code table can be tested without a network. Groups are checked
    in order of how blocking they are: a rejected document stops verification
    dead, a keyed identity mismatch is a field edit, a website error is often the
    last thing left. An unrecognised code returns `unmapped` rather than `clear`,
    because Stripe adds codes and a table that silently swallows new ones is
    worse than no table.

    Returns (state, detail).
    """
    items = [e for e in (errors or []) if isinstance(e, dict) and e.get("code")]
    if not items:
        return ("clear", "requirements.errors is empty")

    for state, table in GROUPS:
        for e in items:
            if e["code"] in table:
                return (state, "%s on %s: %s"
                        % (e["code"], e.get("requirement") or "an unnamed requirement",
                           table[e["code"]]))

    for e in items:
        if str(e["code"]).startswith(WEBSITE_PREFIX):
            return ("website",
                    "%s on %s: fix the site itself, then set business_profile[url] "
                    "to another value and back to force re-verification"
                    % (e["code"], e.get("requirement") or "business_profile.url"))

    e = items[0]
    return ("unmapped", "%s on %s: %s"
            % (e["code"], e.get("requirement") or "an unnamed requirement",
               e.get("reason") or "no reason string returned"))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def accounts(session, cap):
    """Yield connected accounts, paginating until Stripe stops or the cap is hit."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/accounts", **params)
        data = page.get("data", [])
        for acct in data:
            yield acct
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def error_sources(session, account, deep):
    """Yield (where, errors) for every place a verification error can hide."""
    reqs = account.get("requirements") or {}
    future = account.get("future_requirements") or {}
    yield ("account", reqs.get("errors") or [])
    yield ("future", future.get("errors") or [])
    if not deep:
        return
    acct_id = account.get("id", "")
    persons = get(session, "/accounts/%s/persons" % acct_id, limit=100)
    for p in persons.get("data") or []:
        preqs = p.get("requirements") or {}
        yield ("person %s" % p.get("id", "person_?"), preqs.get("errors") or [])
    caps = get(session, "/accounts/%s/capabilities" % acct_id)
    for c in caps.get("data") or []:
        creqs = c.get("requirements") or {}
        yield ("capability %s" % c.get("id", "?"), creqs.get("errors") or [])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=5000,
                    help="stop paginating after this many accounts")
    ap.add_argument("--persons", action="store_true",
                    help="also read persons and capabilities, two extra GETs each")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    with_errors = 0
    unmapped = 0
    scanned = 0
    for acct in accounts(s, args.max_accounts):
        scanned += 1
        hits = 0
        for where, errors in error_sources(s, acct, args.persons):
            state, detail = classify(errors)
            if state == "clear":
                continue
            hits += 1
            if state == "unmapped":
                unmapped += 1
            log.warning("%s  %-9s %-12s %s",
                        acct.get("id", "acct_?"), state, where, detail)
        if hits:
            with_errors += 1

    log.info("%d account(s): %d with errors, %d unmapped code(s)",
             scanned, with_errors, unmapped)

    if with_errors:
        log.warning("  repair: show the mapped instruction and the reason string "
                    "in your onboarding UI, then require a genuinely different "
                    "submission. The same file re-uploaded fails on its own.")
        log.warning("  documents: upload to https://files.stripe.com/v1/files with "
                    "purpose=identity_document, then attach the file id to the "
                    "person's verification[document][front]")
        log.warning("  fields: POST %s/accounts/{id} with the corrected values", API)
    if unmapped:
        log.warning("  add the unmapped code(s) above to the table in this script. "
                    "Stripe adds codes; a stale table shows a seller nothing.")
    if not args.persons:
        log.info("  re-run with --persons: on a company account the account-level "
                 "array is often empty while a director's is not")
    return 1 if with_errors else 0


if __name__ == "__main__":
    sys.exit(main())
