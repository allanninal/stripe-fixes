# manual-capture holds expire before anyone captures them

A customer messages to say the pending charge disappeared from their statement, and they are pleased about it. You go to capture the payment, and Stripe answers charge_expired_for_capture. The order shipped. The authorization is gone, the money was never taken, and no retry exists that can take it now.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/expired-manual-capture-holds/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_manual_capture_holds.py
node node/stripe-manual-capture-holds.mjs
```

## Test it

```bash
pytest python/test_stripe_manual_capture_holds.py
node --test node/stripe-manual-capture-holds.test.mjs
```
