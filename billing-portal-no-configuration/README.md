# no Billing Portal configuration, so portal sessions 400

The Manage subscription button worked all through development. On the day it goes live it throws a 500, and the log underneath it reads No configuration provided and your default configuration has not been created. Nothing about the deploy changed the portal code, because the thing that is missing was never in the code.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/billing-portal-no-configuration/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_portal_configuration.py
node node/stripe-portal-configuration.mjs
```

## Test it

```bash
pytest python/test_stripe_portal_configuration.py
node --test node/stripe-portal-configuration.test.mjs
```
