# refunds sit failed or requires_action and nobody notices

Support issued the refund, the ticket was closed, and the money left your Stripe balance. Weeks later the same customer opens a dispute for the same transaction, because it never arrived. You now pay the amount twice and the dispute fee on top, and the only record of what went wrong was a status change on an object nobody was watching.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/refunds-failed-or-stuck/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_refund_health.py
node node/stripe-refund-health.mjs
```

## Test it

```bash
pytest python/test_stripe_refund_health.py
node --test node/stripe-refund-health.test.mjs
```
