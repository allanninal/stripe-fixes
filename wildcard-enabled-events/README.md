# an endpoint subscribes to every event and floods the handler

The webhook route is slow, and it is slow at the worst possible time: the end of the month, when renewals run. It handles four event types. It is being sent everything Stripe generates, and the other ninety-odd types still cost a request, a signature verification, and a database round trip before the handler decides it does not care.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/wildcard-enabled-events/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_wildcard_events.py
node node/stripe-wildcard-events.mjs
```

## Test it

```bash
pytest python/test_stripe_wildcard_events.py
node --test node/stripe-wildcard-events.test.mjs
```
