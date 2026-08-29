# past_due subscriptions keep their access forever

Renewals have been failing for months and nobody noticed, because the customers are still logged in and still using the product. The entitlement check in your app asks whether the subscription is canceled. It is not canceled. It is past_due, which the check has never heard of, so the answer is yes, let them in.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/past-due-subscriptions-accumulating/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_past_due_subs.py
node node/stripe-past-due-subs.mjs
```

## Test it

```bash
pytest python/test_stripe_past_due_subs.py
node --test node/stripe-past-due-subs.test.mjs
```
