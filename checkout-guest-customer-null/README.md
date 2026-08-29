# guest checkouts finish with customer null and can't be linked

Somebody writes in asking for a copy of a receipt from March. You search the Dashboard for their email address and find four separate payments, no Customer record, no purchase history, and nothing you can open the Billing Portal against. Every one of those four checkouts completed perfectly. None of them left behind anything that ties the four together.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-guest-customer-null/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_checkout_guests.py
node node/stripe-checkout-guests.mjs
```

## Test it

```bash
pytest python/test_stripe_checkout_guests.py
node --test node/stripe-checkout-guests.test.mjs
```
