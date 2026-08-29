# duplicate customers share an email and split billing

A customer writes in to say they were charged twice this month. Support finds their subscription, checks it, and it billed once. The second charge is on a different Customer record with the same email address, created the day they resubscribed, and it has its own card, its own subscription and its own renewal date.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/duplicate-customers-same-email/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_duplicate_customers.py
node node/stripe-duplicate-customers.mjs
```

## Test it

```bash
pytest python/test_stripe_duplicate_customers.py
node --test node/stripe-duplicate-customers.test.mjs
```
