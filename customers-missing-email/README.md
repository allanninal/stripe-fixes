# customers have no email, so Stripe sends no receipts

A dispute arrives with the reason &ldquo;unrecognised&rdquo;. The cardholder is a real, current customer, and they are not lying: they never got a receipt, so the only thing linking that line on their statement to your business is a descriptor they have never seen before. The Customer record has an email column and it is empty.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/customers-missing-email/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_customers_missing_email.py
node node/stripe-customers-missing-email.mjs
```

## Test it

```bash
pytest python/test_stripe_customers_missing_email.py
node --test node/stripe-customers-missing-email.test.mjs
```
