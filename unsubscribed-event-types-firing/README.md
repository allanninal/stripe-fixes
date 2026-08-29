# event types are firing that no endpoint subscribes to

A whole class of business event is invisible to the application, and there is no error anywhere to explain it. The events exist. They are in GET /v1/events with the right data on them. They were never delivered, because no endpoint asked for them, and an event nobody asked for is not a failure &mdash; it is a non-event.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/unsubscribed-event-types-firing/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_unsubscribed_events.py
node node/stripe-unsubscribed-events.mjs
```

## Test it

```bash
pytest python/test_stripe_unsubscribed_events.py
node --test node/stripe-unsubscribed-events.test.mjs
```
