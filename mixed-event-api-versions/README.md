# recent events carry two different api_version values

Nothing here is a configuration field you can go and correct. The drift note is about endpoints disagreeing; this is about the stored events themselves. Event objects are immutable and rendered at whatever the account default was when they occurred, so an upgrade cuts a hard line across the 30-day window. Everything after it is one shape, everything before it is another, and a backfill walks straight through the boundary.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/mixed-event-api-versions/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_event_version_boundary.py
node node/stripe-event-version-boundary.mjs
```

## Test it

```bash
pytest python/test_stripe_event_version_boundary.py
node --test node/stripe-event-version-boundary.test.mjs
```
