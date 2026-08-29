# report runs past data_available_end return short data

The month-end report succeeded. The totals are lower than the Dashboard by a few thousand, and re-running the identical report the next morning produces a larger number. Nothing errored either time, which is the part that makes this take a day to find: a report that is short does not look any different from a report that is complete.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/report-interval-past-data-available-end/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_report_interval.py
node node/stripe-report-interval.mjs
```

## Test it

```bash
pytest python/test_stripe_report_interval.py
node --test node/stripe-report-interval.test.mjs
```
