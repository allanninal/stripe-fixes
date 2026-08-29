# automatic_tax reports requires_location_inputs on live bills

Stripe Tax is enabled, the integration passes automatic_tax[enabled]=true everywhere, and the totals look right on every invoice anyone has opened. They have been opening the wrong ones. A slice of the customers &mdash; the ones whose addresses were never captured properly &mdash; have been billed and paid with no tax calculated, and the invoices carrying that fact are already finalized and immutable.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/automatic-tax-requires-location-inputs/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_tax_location_status.py
node node/stripe-tax-location-status.mjs
```

## Test it

```bash
pytest python/test_stripe_tax_location_status.py
node --test node/stripe-tax-location-status.test.mjs
```
