# payment-creating requests carry no idempotency key

A customer is charged twice. It happens perhaps once a week, always to someone on a phone, always during a moment when the network was bad, and never once on a developer machine. There is no bug in the checkout code. There is a missing HTTP header, and the events already recorded which requests were sent without it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-idempotency-keys-on-payments/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_idempotency_keys.py
node node/stripe-idempotency-keys.mjs
```

## Test it

```bash
pytest python/test_stripe_idempotency_keys.py
node --test node/stripe-idempotency-keys.test.mjs
```
