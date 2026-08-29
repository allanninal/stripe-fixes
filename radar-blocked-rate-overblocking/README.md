# radar is blocking a large share of your charge attempts

Conversion stepped down on a specific day and stayed there. Support is hearing the same sentence from different customers: the card works everywhere else. It does work everywhere else &mdash; those payments were stopped before they were ever sent to an issuer, by a rule somebody wrote here.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/radar-blocked-rate-overblocking/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_block_rate.py
node node/stripe-block-rate.mjs
```

## Test it

```bash
pytest python/test_stripe_block_rate.py
node --test node/stripe-block-rate.test.mjs
```
