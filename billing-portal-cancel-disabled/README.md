# billing portal can't cancel, so customers charge back instead

Your dispute rate is drifting up and the reasons cluster on one code: subscription_canceled. These are not fraudsters. They are customers who wanted to stop paying, could not find a way to do it, emailed support, waited, and then used the one cancellation mechanism that always works &mdash; their bank.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/billing-portal-cancel-disabled/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_portal_cancel_disabled.py
node node/stripe-portal-cancel-disabled.mjs
```

## Test it

```bash
pytest python/test_stripe_portal_cancel_disabled.py
node --test node/stripe-portal-cancel-disabled.test.mjs
```
