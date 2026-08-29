# incomplete_expired volume means confirmation is broken

Sign-ups are steady, marketing spend is steady, and paid subscriptions are down. There are no failed payments to look at, because no payment was ever attempted. Filter the subscription list to incomplete_expired and there they are: a few hundred people who thought they had subscribed, in a state that Stripe considers finished.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/incomplete-expired-signup-leak/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_incomplete_expired_rate.py
node node/stripe-incomplete-expired-rate.mjs
```

## Test it

```bash
pytest python/test_stripe_incomplete_expired_rate.py
node --test node/stripe-incomplete-expired-rate.test.mjs
```
