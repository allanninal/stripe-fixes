# paymentIntents sit in requires_payment_method for weeks

The Payments page shows a long tail of incomplete payments that never resolve into anything. Checkout starts and successful payments have drifted apart by a factor nobody can explain, and the gap grows every week. Most of those intents were never going to succeed: they were created before the customer had done anything, and nothing ever went back to them.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/stale-requires-payment-method-intents/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_stale_intents.py
node node/stripe-stale-intents.mjs
```

## Test it

```bash
pytest python/test_stripe_stale_intents.py
node --test node/stripe-stale-intents.test.mjs
```
