# metered subscription items with no usage reported

The invoice goes out with the usage line at zero. The customer has been hammering the API all month and your own dashboards say so, but Stripe has no record of a single unit. The subscription is active, the price is metered, nothing has errored anywhere, and the invoice has already finalized, which is the point past which usage cannot be added to it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/metered-items-with-no-usage-reported/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_metered_usage.py
node node/stripe-metered-usage.mjs
```

## Test it

```bash
pytest python/test_stripe_metered_usage.py
node --test node/stripe-metered-usage.test.mjs
```
