# customer.subscription.deleted is missing, so access never ends

A support ticket arrives from somebody trying to be helpful: they cancelled two months ago and can still log in and use everything. You check Stripe and they really did cancel, on time, and the subscription really is canceled. The revenue reporting is correct. It is only the entitlement in your own database that has never been told.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-subscription-deleted/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_subscription_deleted_events.py
node node/stripe-subscription-deleted-events.mjs
```

## Test it

```bash
pytest python/test_stripe_subscription_deleted_events.py
node --test node/stripe-subscription-deleted-events.test.mjs
```
