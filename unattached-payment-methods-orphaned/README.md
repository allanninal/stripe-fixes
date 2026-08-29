# PaymentMethods are created but never attached to a customer

The first charge works. The customer comes back a month later, picks their saved card, and the request fails with a sentence about a PaymentMethod that was previously used without being attached to a Customer. The pm_ id is right there in your database, it looks fine, and it will never work again.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/unattached-payment-methods-orphaned/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_orphaned_payment_methods.py
node node/stripe-orphaned-payment-methods.mjs
```

## Test it

```bash
pytest python/test_stripe_orphaned_payment_methods.py
node --test node/stripe-orphaned-payment-methods.test.mjs
```
