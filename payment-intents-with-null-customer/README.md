# PaymentIntents have a null customer, so payments are orphaned

Someone in support asks a simple question: how many times has this person bought from us? There is no answer. Their payments are in Stripe, four of them, all succeeded, all with the customer column empty. Same card, same email in the billing details, four separate strangers as far as Stripe is concerned &mdash; and as far as Radar is concerned too.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payment-intents-with-null-customer/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_orphan_payments.py
node node/stripe-orphan-payments.mjs
```

## Test it

```bash
pytest python/test_stripe_orphan_payments.py
node --test node/stripe-orphan-payments.test.mjs
```
