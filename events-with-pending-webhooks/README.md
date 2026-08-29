# events still show pending_webhooks hours after they fired

Most payments are processed and some are not. There is no pattern anyone can see: the same customer, the same product, the same code path, and one order exists while the next does not. The endpoint is enabled, the Dashboard shows no banner, and your logs show the handler running successfully for every request it received.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/events-with-pending-webhooks/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_pending_webhooks.py
node node/stripe-pending-webhooks.mjs
```

## Test it

```bash
pytest python/test_stripe_pending_webhooks.py
node --test node/stripe-pending-webhooks.test.mjs
```
