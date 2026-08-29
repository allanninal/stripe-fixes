# active subscriptions with nothing to charge on renewal

The subscription says active. The customer has access, the MRR chart counts them, and the renewal date is in the calendar. Then the renewal date arrives and the invoice fails, and it fails again next month, and Stripe never retries any of it &mdash; because there is nothing to retry against.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/subscription-without-payment-method/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_sub_payment_method.py
node node/stripe-sub-payment-method.mjs
```

## Test it

```bash
pytest python/test_stripe_sub_payment_method.py
node --test node/stripe-sub-payment-method.test.mjs
```
