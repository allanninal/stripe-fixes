# future_requirements will revoke a capability on a date

Fourteen connected accounts stopped taking payments on the same Thursday morning. All of them were fully verified. None of them had anything in requirements the night before, and the monitor that reads requirements every hour never made a sound. The fields that disabled them had been sitting on the same objects for six weeks, in a different hash, with the date printed on it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/future-requirements-deadline-ignored/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_future_requirements.py
node node/stripe-future-requirements.mjs
```

## Test it

```bash
pytest python/test_stripe_future_requirements.py
node --test node/stripe-future-requirements.test.mjs
```
