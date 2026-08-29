# incomplete subscriptions die silently after 23 hours

Someone filled in the card form, saw a spinner, and closed the tab believing they had subscribed. Stripe has a subscription for them in incomplete. In under a day that record becomes incomplete_expired, the open invoice is voided, and there is nothing left to recover &mdash; no charge, no error, no ticket.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/subscriptions-stuck-incomplete/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_incomplete_subs.py
node node/stripe-incomplete-subs.mjs
```

## Test it

```bash
pytest python/test_stripe_incomplete_subs.py
node --test node/stripe-incomplete-subs.test.mjs
```
