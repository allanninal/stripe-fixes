# refunds nobody issued with reason expired_uncaptured_charge

Somebody in the monthly review asks why the refund rate went from 1.2% to 3.1%. Support has no extra tickets. Nobody remembers approving a wave of refunds, and the finance export shows money going back out that never came in. Every one of those refunds was written by Stripe, and no customer asked for a single one.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/uncaptured-charge-expiry-refunds/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_expired_capture_refunds.py
node node/stripe-expired-capture-refunds.mjs
```

## Test it

```bash
pytest python/test_stripe_expired_capture_refunds.py
node --test node/stripe-expired-capture-refunds.test.mjs
```
