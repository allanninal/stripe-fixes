# a Connect platform has no endpoint for connected accounts

The endpoint is enabled. It is subscribed to account.updated. It has been in the dashboard for two years and it delivers thousands of events a week without a single failure. And it has never once received an event about a connected account, because the thing that decides whether it does is not in enabled_events and is not returned on the object you are looking at.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/connect-platform-missing-account-updated/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_connect_webhook_scope.py
node node/stripe-connect-webhook-scope.mjs
```

## Test it

```bash
pytest python/test_stripe_connect_webhook_scope.py
node --test node/stripe-connect-webhook-scope.test.mjs
```
