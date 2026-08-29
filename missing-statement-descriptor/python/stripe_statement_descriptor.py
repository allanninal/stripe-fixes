"""Report Stripe accounts whose statement descriptor is missing or inconsistent.

Read only. Three paginated GETs and no writes: give this a RESTRICTED key with
read access to Account, Charges and Disputes. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_statement_descriptor")

API = "https://api.stripe.com/v1"

MIN_LEN = 5
MAX_LEN = 22
MIN_LETTERS = 5
BANNED = ("<", ">", "'", '"')

# Reason codes a customer gives when the line on the statement meant nothing.
UNRECOGNISED = ("unrecognized", "general", "duplicate")


def verdict(prefix, descriptors):
    """Classify the account's descriptor. Pure, so the format rules test offline.

    `prefix` is the configured static prefix; `descriptors` is every
    calculated_statement_descriptor observed on recent charges. Returns
    (state, detail).
    """
    seen = sorted({(d or "").strip() for d in (descriptors or [])} - {""})
    if not (prefix or "").strip():
        return ("unset",
                "no statement descriptor prefix on the account; %d distinct "
                "descriptor(s) observed on charges" % len(seen))
    if descriptors and not seen:
        return ("blank",
                "a prefix is configured but every charge carried an empty "
                "descriptor: nothing identifying you reaches the networks")
    if len(seen) > 1:
        return ("fragmented",
                "%d distinct descriptors in use (%s): Visa identifies a monitored "
                "account by the static component, so your volume is being split"
                % (len(seen), ", ".join(seen[:3])))
    text = seen[0] if seen else prefix.strip()
    letters = sum(1 for c in text if c.isalpha())
    if len(text) < MIN_LEN or len(text) > MAX_LEN:
        return ("malformed",
                "%r is %d characters; Stripe requires %d to %d"
                % (text, len(text), MIN_LEN, MAX_LEN))
    if letters < MIN_LETTERS:
        return ("malformed",
                "%r has %d letter(s); Stripe requires at least %d"
                % (text, letters, MIN_LETTERS))
    if any(c in text for c in BANNED):
        return ("malformed",
                "%r contains a character Stripe disallows in a descriptor" % text)
    return ("consistent", "%s across the sampled charges" % text)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page(session, path, cap, **params):
    out = []
    params = dict(params)
    params["limit"] = 100
    while True:
        p = get(session, path, **params)
        data = p.get("data", [])
        out.extend(data)
        if not data or not p.get("has_more") or len(out) >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to sample charges")
    ap.add_argument("--dispute-days", type=int, default=180,
                    help="how far back to read disputes")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating after this many charges")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    account = get(s, "/account")
    settings = account.get("settings") or {}
    prefix = ((settings.get("card_payments") or {}).get("statement_descriptor_prefix")
              or (settings.get("payments") or {}).get("statement_descriptor"))

    now = time.time()
    charges = page(s, "/charges", args.max_charges,
                   **{"created[gte]": int(now - args.days * 86400)})
    descriptors = [c.get("calculated_statement_descriptor") for c in charges]
    no_suffix = sum(1 for c in charges if not c.get("statement_descriptor_suffix"))

    state, detail = verdict(prefix, descriptors)
    log.info("%-11s %s (%d charge(s) sampled)", state, detail, len(charges))

    disputes = page(s, "/disputes", 1000,
                    **{"created[gte]": int(now - args.dispute_days * 86400)})
    if disputes:
        blind = sum(1 for d in disputes if d.get("reason") in UNRECOGNISED)
        log.info("%.1f%% of disputes cite unrecognized, general or duplicate (%d of %d)",
                 100.0 * blind / len(disputes), blind, len(disputes))

    if state == "consistent" and not no_suffix:
        return 0

    if state != "consistent":
        log.warning("  set the prefix in Dashboard, Settings, Business, public "
                    "business information: %d to %d characters, at least %d letters, "
                    "and none of %s", MIN_LEN, MAX_LEN, MIN_LETTERS, " ".join(BANNED))
        log.warning("  use the website domain or the business name customers know, "
                    "and keep it identical across every payment flow")
    if no_suffix:
        log.warning("  %d of %d charge(s) carried no statement_descriptor_suffix. Set "
                    "one at payment creation so the line names the order.",
                    no_suffix, len(charges))
    return 1


if __name__ == "__main__":
    sys.exit(main())
