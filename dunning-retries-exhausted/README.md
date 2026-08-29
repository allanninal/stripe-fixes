# dunning ran out of retries and no attempt is scheduled

A card expired in May. Stripe retried it eight times over two weeks, each attempt failed, and then it stopped, which is exactly what it is supposed to do. Nothing announced the end of that sequence. The invoice is still open, the customer still has access, and the last human to look at the account was the one who set up the subscription.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/dunning-retries-exhausted/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dunning_exhausted.py
node node/stripe-dunning-exhausted.mjs
```

## Test it

```bash
pytest python/test_stripe_dunning_exhausted.py
node --test node/stripe-dunning-exhausted.test.mjs
```
