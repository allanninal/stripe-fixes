# sigma scheduled query runs time out and email nothing

Finance asks where the Monday numbers went, and it turns out they have not arrived for six weeks. Nobody raised it earlier because the alert for this failure is an email that does not appear, and an email that does not appear looks exactly like a week where nothing happened.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/sigma-scheduled-query-failing/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_sigma_runs.py
node node/stripe-sigma-runs.mjs
```

## Test it

```bash
pytest python/test_stripe_sigma_runs.py
node --test node/stripe-sigma-runs.test.mjs
```
