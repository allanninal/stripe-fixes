# platform-paused payouts were never unpaused

In March, risk paused a seller while a chargeback pattern was investigated. In April the investigation closed with nothing found, the ticket was marked resolved, and everyone moved on. It is now September. The seller has been taking payments the whole time, the money has been accumulating, and the pause is still on, because unpausing was a manual step in a dashboard and nothing anywhere remembers that it was owed.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/platform-paused-payouts-left-on/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_platform_paused.py
node node/stripe-platform-paused.mjs
```

## Test it

```bash
pytest python/test_stripe_platform_paused.py
node --test node/stripe-platform-paused.test.mjs
```
