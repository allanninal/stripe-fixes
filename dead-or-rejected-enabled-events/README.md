# enabled_events lists event types that are dead or rejected

Card-expiry reminder emails stopped going out. Nobody can say when, because nothing failed: the handler branch simply never runs, and a branch that never runs produces no logs. Separately, and apparently unrelatedly, an attempt to add one new event type to the endpoint comes back with You do not have access to the event types, naming a type that has been in the list for years.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/dead-or-rejected-enabled-events/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dead_event_types.py
node node/stripe-dead-event-types.mjs
```

## Test it

```bash
pytest python/test_stripe_dead_event_types.py
node --test node/stripe-dead-event-types.test.mjs
```
