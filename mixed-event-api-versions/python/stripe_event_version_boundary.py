"""Report a version boundary inside the retained Stripe event stream.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
read access to Events and Webhook Endpoints. The repair is a code change and is
printed, never performed, because this script holds a credential to a live
payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_event_version_boundary")

API = "https://api.stripe.com/v1"

# An event with no api_version gets its own bucket rather than being dropped.
# Dropping it hides the transition that produced it.
UNREPORTED = "unreported"


def label(api_version):
    """One event's version, with a bucket for the absent case. Pure."""
    if api_version is None or api_version == "":
        return UNREPORTED
    return str(api_version)


def verdict(events):
    """Classify the window. Pure, so the ordering logic can be tested offline.

    `events` is a list of dicts with `api_version` and `created`, NEWEST FIRST,
    which is the order the events API returns. Returns (state, detail).
    """
    if not events:
        return ("empty", "no events in the window: nothing to compare")

    seq = [label(e.get("api_version")) for e in events]
    distinct = sorted(set(seq))
    if len(distinct) == 1:
        return ("single",
                "every one of the %d event(s) sampled rendered at %s"
                % (len(seq), distinct[0]))

    transitions = []
    for i in range(len(seq) - 1):
        if seq[i] != seq[i + 1]:
            transitions.append((events[i].get("created"), seq[i + 1], seq[i]))

    if len(transitions) == 1:
        at, older, newer = transitions[0]
        return ("boundary",
                "two shapes in the window: %s up to created=%s, %s from there "
                "on. Any backfill across this window walks through both."
                % (older, at, newer))
    return ("churn",
            "%d transitions between %d versions (%s). That is an upgrade "
            "followed by a rollback inside the 72 hour window: the shape "
            "alternates rather than changing once."
            % (len(transitions), len(distinct), ", ".join(distinct)))


def exposure(endpoint_versions):
    """Did the boundary reach a handler? Pure.

    `endpoint_versions` is the raw api_version of each enabled endpoint. An
    unpinned endpoint follows the account default, so it moved with the stream.
    """
    if not endpoint_versions:
        return ("no-endpoints",
                "no enabled endpoints: the boundary only affects code reading "
                "the events API directly")
    unpinned = [v for v in endpoint_versions if v is None or v == ""]
    if unpinned:
        return ("inherited",
                "%d of %d enabled endpoint(s) are unpinned and follow the "
                "account default, so the boundary was delivered to your handler"
                % (len(unpinned), len(endpoint_versions)))
    return ("pinned",
            "all %d enabled endpoint(s) are pinned, so delivered payloads keep "
            "one shape. The boundary shows up in replays and backfills."
            % len(endpoint_versions))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def sample_events(session, limit):
    """Events newest first, paginated, up to `limit`."""
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def enabled_endpoint_versions(session):
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/webhook_endpoints", **params)
        data = page.get("data", [])
        out.extend(e.get("api_version") for e in data if e.get("status") == "enabled")
        if not data or not page.get("has_more"):
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=5000,
                    help="stop paginating the event stream after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    events = sample_events(s, args.max_events)
    state, detail = verdict(events)
    reach, reach_detail = exposure(enabled_endpoint_versions(s))

    log.info("  sampled %d event(s)", len(events))
    log.info("  %-12s %s", reach, reach_detail)

    if state in ("single", "empty"):
        log.info("%s  %s", state, detail)
        return 0

    log.warning("%s  %s", state, detail)
    log.warning("  there is no Stripe-side repair: stored events are immutable "
                "and are never re-rendered")
    log.warning("  branch on event.api_version for the 30 days the two shapes "
                "coexist, then delete the branch")
    log.warning("  or stop trusting data.object during the overlap and re-fetch "
                "the object by id, which is rendered at your request's version")
    return 1


if __name__ == "__main__":
    sys.exit(main())
