# undelivered events are aging out of the 30-day window

The handler is fixed. The endpoint is enabled again. Now someone has to replay three weeks of missed events, and a quiet arithmetic problem is waiting: Stripe keeps events for 30 days, the oldest ones are on day 26, and the backfill script has not been written yet.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/undelivered-events-nearing-retention/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_event_retention.py
node node/stripe-event-retention.mjs
```

## Test it

```bash
pytest python/test_stripe_event_retention.py
node --test node/stripe-event-retention.test.mjs
```
