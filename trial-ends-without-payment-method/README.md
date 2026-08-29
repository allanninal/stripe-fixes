# trials ending in days with no card on file

Card-free trials are good for signups and they build a queue. Everyone who started a trial on the first of the month reaches its end on the same day, and the ones without a card all fail together. What happens next is one Stripe setting most teams have never opened, and its default is the loudest of the three options and the quietest to you.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/trial-ends-without-payment-method/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_trial_no_card.py
node node/stripe-trial-no-card.mjs
```

## Test it

```bash
pytest python/test_stripe_trial_no_card.py
node --test node/stripe-trial-no-card.test.mjs
```
