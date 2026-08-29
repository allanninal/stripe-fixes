# the platform collects zero application fees on its charges

The marketplace is working. Volume is up, sellers are getting paid, the Connect dashboard is busy. The platform's own revenue line reads zero, and has since launch. Nothing errored: every charge did exactly what it was told, which was to pass the whole amount through.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/application-fees-zero-on-platform/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_application_fees.py
node node/stripe-application-fees.mjs
```

## Test it

```bash
pytest python/test_stripe_application_fees.py
node --test node/stripe-application-fees.test.mjs
```
