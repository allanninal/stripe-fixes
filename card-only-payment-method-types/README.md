# intents hardcode payment_method_types to card only

You turned on iDEAL, Bancontact, Klarna and Link in the Dashboard weeks ago. The toggles are still on. The Payment Element in production still renders one card form, and conversion in the Netherlands is still flat. Nothing is broken and no error is thrown &mdash; the intent told Stripe exactly which methods to offer, and it named one.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/card-only-payment-method-types/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payment_method_coverage.py
node node/stripe-payment-method-coverage.mjs
```

## Test it

```bash
pytest python/test_stripe_payment_method_coverage.py
node --test node/stripe-payment-method-coverage.test.mjs
```
