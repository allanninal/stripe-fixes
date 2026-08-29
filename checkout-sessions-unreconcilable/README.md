# Checkout Sessions carry no ID that maps back to your order

Support is reconciling payments by matching an email address and an amount against the order table by hand. It works, mostly, until two people buy the same thing on the same day. Then a dispute arrives on one of those charges and nobody can say with confidence which order it was, which is a bad position to answer a dispute from.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-sessions-unreconcilable/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_checkout_reconciliation.py
node node/stripe-checkout-reconciliation.mjs
```

## Test it

```bash
pytest python/test_stripe_checkout_reconciliation.py
node --test node/stripe-checkout-reconciliation.test.mjs
```
