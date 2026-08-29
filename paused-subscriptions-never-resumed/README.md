# paused subscriptions never resume and never invoice again

Somebody set trials to pause instead of dunning when no card was attached, which was the right call. Nobody built the other half. Two years of trials that ended without a card are sitting in paused, generating nothing, appearing in no past-due report, and waiting for a resume that is not coming.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/paused-subscriptions-never-resumed/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_paused_subscriptions.py
node node/stripe-paused-subscriptions.mjs
```

## Test it

```bash
pytest python/test_stripe_paused_subscriptions.py
node --test node/stripe-paused-subscriptions.test.mjs
```
