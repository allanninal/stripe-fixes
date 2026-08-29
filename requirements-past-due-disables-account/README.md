# requirements.past_due has already disabled the payouts

There is a monitor. It runs daily, it reads every connected account, and it alerts when requirements.currently_due is not empty. It has been green for a month. A seller's payouts stopped eleven days ago and the monitor never said a word about it, because the field that would have told it apart from routine housekeeping is a different array on the same object.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/requirements-past-due-disables-account/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_requirements_past_due.py
node node/stripe-requirements-past-due.mjs
```

## Test it

```bash
pytest python/test_stripe_requirements_past_due.py
node --test node/stripe-requirements-past-due.test.mjs
```
