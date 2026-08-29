# a report run fails after the 200 and the CSV never lands

Finance says the nightly export has been missing for a week. Your job logs say it succeeded every night, and they are not lying: creating a report run returned 200 and the job exited zero. The run failed twenty seconds later, in Stripe, where nobody was looking.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/report-run-failed-silently/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_report_runs.py
node node/stripe-report-runs.mjs
```

## Test it

```bash
pytest python/test_stripe_report_runs.py
node --test node/stripe-report-runs.test.mjs
```
