# unpaid subscriptions keep access and stop billing entirely

A handful of customers are still logged in and still using everything, and the last money any of them sent you was months ago. Their subscriptions are not canceled and they are not past_due either. They are unpaid, which is the state Stripe parks a subscription in when it has finished trying and been told not to cancel.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/unpaid-subscriptions-still-provisioned/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_unpaid_subscriptions.py
node node/stripe-unpaid-subscriptions.mjs
```

## Test it

```bash
pytest python/test_stripe_unpaid_subscriptions.py
node --test node/stripe-unpaid-subscriptions.test.mjs
```
