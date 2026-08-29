# no endpoint subscribes to any payment failure event

Every payment that succeeds is handled. Every payment that fails is nothing at all: no event, no branch, no row, no email. The cart stays in processing until somebody writes in, and on the billing side a declined renewal starts a dunning sequence that the application knows nothing about while it is happening.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-payment-failure-events/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payment_failure_events.py
node node/stripe-payment-failure-events.mjs
```

## Test it

```bash
pytest python/test_stripe_payment_failure_events.py
node --test node/stripe-payment-failure-events.test.mjs
```
