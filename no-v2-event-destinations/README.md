# no v2 event destination exists, so thin events never arrive

The feature you turned on documents an event with a v1. prefix in its name. Somebody added it to the webhook endpoint, saved, and nothing happened &mdash; no delivery, no failure, no entry in the endpoint's log. The event is real and it is being generated. It is being handed to a kind of destination your account does not have.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/no-v2-event-destinations/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_v2_event_destinations.py
node node/stripe-v2-event-destinations.mjs
```

## Test it

```bash
pytest python/test_stripe_v2_event_destinations.py
node --test node/stripe-v2-event-destinations.test.mjs
```
