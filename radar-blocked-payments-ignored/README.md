# radar blocks payments and nobody reads the block reasons

Support keeps hearing the same sentence: my card works everywhere else. The charge shows as failed with a message that says nothing, the customer's bank has no record of the attempt at all, and nobody on your side can say why. The payment never left Stripe.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/radar-blocked-payments-ignored/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_radar_blocks.py
node node/stripe-radar-blocks.mjs
```

## Test it

```bash
pytest python/test_stripe_radar_blocks.py
node --test node/stripe-radar-blocks.test.mjs
```
