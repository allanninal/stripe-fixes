# card_payments inactive disables transfers as well

You read capabilities.transfers, saw inactive, fetched the capability, collected the two fields in its currently_due, and submitted them. Stripe accepted the update. The capability is still inactive, its currently_due is now empty, and transfers still fail. Nothing you can see on that capability explains it, because the requirement holding it down is filed under a different one.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/card-payments-inactive-cascades/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_capability_coupling.py
node node/stripe-capability-coupling.mjs
```

## Test it

```bash
pytest python/test_stripe_capability_coupling.py
node --test node/stripe-capability-coupling.test.mjs
```
