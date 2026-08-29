# current_deadline passes before anyone collects the fields

Nine sellers lost payouts on the same Monday. All nine had been processing happily for months, all nine had payouts_enabled: true on Sunday night, and all nine had the same Unix timestamp sitting in requirements.current_deadline since the middle of the previous month. Nothing read it. It is a number, not a flag, and every check anyone had written asked yes-or-no questions.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/current-deadline-passes-unwatched/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_current_deadline.py
node node/stripe-current-deadline.mjs
```

## Test it

```bash
pytest python/test_stripe_current_deadline.py
node --test node/stripe-current-deadline.test.mjs
```
