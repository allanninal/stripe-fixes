# 3DS handoff breaks and requires_action intents pile up

Card volume from Europe and India reads lower than your traffic says it should. Nothing fails. There are no declines to look at, no errors in the logs, and no support tickets, because from the customer's side the page simply did nothing. The intents stopped at requires_action and stayed there.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/abandoned-requires-action-intents/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_requires_action.py
node node/stripe-requires-action.mjs
```

## Test it

```bash
pytest python/test_stripe_requires_action.py
node --test node/stripe-requires-action.test.mjs
```
