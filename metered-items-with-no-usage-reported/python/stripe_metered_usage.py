"""Report metered subscription items that no usage has been recorded against.

Read only. Three GETs, no writes: give this a RESTRICTED key with read access to
Subscriptions, Billing Meters and Invoices. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_metered_usage")

API = "https://api.stripe.com/v1"

# A period that opened minutes ago has no usage yet on almost any product, and
# reporting that as a fault trains people to ignore the check on the 1st.
GRACE_HOURS = 6


def verdict(aggregated_value, summary_rows, hours_into_period, zero_billed_cycles):
    """Classify one metered subscription item. Pure, so the rules can be tested.

    `aggregated_value` is the sum of aggregated_value across the meter's event
    summaries for this customer and period, `summary_rows` how many rows came
    back, `hours_into_period` how far into the current period we are, and
    `zero_billed_cycles` how many already-paid invoices carry a zero line.
    Returns (state, detail).
    """
    if aggregated_value:
        return ("reporting",
                "%s unit(s) so far this period" % format(aggregated_value, ",g"))
    if hours_into_period < GRACE_HOURS:
        return ("early",
                "the period is %.1fh old; too early to call zero a fault"
                % hours_into_period)

    if summary_rows:
        cause = ("%d summary row(s) and every one aggregates to 0: the events "
                 "arrive and carry no value. Check value_settings."
                 "event_payload_key against the payload." % summary_rows)
        state = "zero-valued"
    else:
        cause = ("no meter event summaries at all for this customer: the events "
                 "never matched. Check event_name first, then customer_mapping."
                 "event_payload_key.")
        state = "silent"

    if zero_billed_cycles:
        return ("billed-zero",
                "%d closed invoice(s) already billed a zero line. %s"
                % (zero_billed_cycles, cause))
    return (state, cause)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def paginate(session, path, **params):
    params = dict(params, limit=params.get("limit", 100))
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for row in data:
            yield row
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def period_bounds(sub, item):
    """Current period for an item.

    current_period_start and current_period_end moved from the subscription onto
    each subscription item, because items on one subscription can now bill on
    different cycles. Read the item, fall back to the subscription, so this works
    either side of that change.
    """
    start = item.get("current_period_start") or sub.get("current_period_start")
    end = item.get("current_period_end") or sub.get("current_period_end")
    return start, end


def usage(session, meter_id, customer, start, end):
    """Return (rows, total) from the meter's event summaries for one customer.

    Both bounds are floored to the hour: the summaries endpoint expects timestamps
    aligned to the meter's grouping window and returns an error for anything else.
    """
    hour = 3600
    params = {"customer": customer,
              "start_time": (start // hour) * hour,
              "end_time": (end // hour) * hour,
              "limit": 100}
    rows, total = 0, 0
    page = get(session, "/billing/meters/%s/event_summaries" % meter_id, **params)
    for row in page.get("data", []):
        rows += 1
        total += row.get("aggregated_value") or 0
    return rows, total


def zero_billed(session, subscription_id, look_back):
    """Count already-paid invoices for this subscription carrying a zero line.

    Matching a line back to a specific price is version dependent, so this counts
    invoices with any zero-amount line instead. It is a corroborating number, not
    the diagnosis.
    """
    count = 0
    for inv in paginate(session, "/invoices", subscription=subscription_id,
                        status="paid", limit=look_back):
        if any((line.get("amount") or 0) == 0
               for line in (inv.get("lines") or {}).get("data", [])):
            count += 1
        if count >= look_back:
            break
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--invoice-look-back", type=int, default=6,
                    help="paid invoices per subscription to check for zero lines")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    findings = 0
    checked = 0

    for sub in paginate(s, "/subscriptions", status="active",
                        **{"expand[]": "data.items.data.price"}):
        for item in (sub.get("items") or {}).get("data", []):
            price = item.get("price") or {}
            recurring = price.get("recurring") or {}
            if recurring.get("usage_type") != "metered":
                continue
            meter_id = recurring.get("meter")
            if not meter_id:
                log.warning("legacy    %s / %s  metered price %s has no meter; "
                            "match it against GET %s/billing/meters by hand",
                            sub["id"], item["id"], price.get("id"), API)
                continue

            checked += 1
            start, end = period_bounds(sub, item)
            if not start:
                continue
            rows, total = usage(s, meter_id, sub["customer"], start, end or now)
            hours = max(0.0, (now - start) / 3600.0)
            zeros = zero_billed(s, sub["id"], args.invoice_look_back) if not total else 0
            state, detail = verdict(total, rows, hours, zeros)

            line = "%-11s %s / %s  meter %s: %s" % (state, sub["id"], item["id"],
                                                    meter_id, detail)
            if state in ("reporting", "early"):
                log.info(line)
                continue

            findings += 1
            log.warning(line)
            log.warning("  compare the emitter payload with the meter definition:")
            log.warning("  GET %s/billing/meters/%s", API, meter_id)
            log.warning("  then backfill this period before its invoice finalizes; "
                        "usage cannot be added to a finalized invoice")

    log.info("checked %d metered item(s), %d not reporting", checked, findings)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
