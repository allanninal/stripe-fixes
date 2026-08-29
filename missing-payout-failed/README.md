# payout.failed is unsubscribed so failures go unseen for days

Money stopped arriving in the bank account. Nothing alerted, nothing errored, and the balance in Stripe kept climbing. On a Connect platform it is worse: the sellers notice before the platform does, and they notice by not being paid.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-payout-failed/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payout_events.py
node node/stripe-payout-events.mjs
```

## Test it

```bash
pytest python/test_stripe_payout_events.py
node --test node/stripe-payout-events.test.mjs
```
