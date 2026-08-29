# a webhook endpoint sits disabled after days of retries

Orders stopped being fulfilled on a Tuesday. Nothing changed in your code that week, nothing appears in your application logs, and Stripe still shows the payments as succeeded. Nothing is arriving at all &mdash; Stripe gave up on the endpoint and stopped trying.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/webhook-endpoint-disabled/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_webhook_health.py
node node/stripe-webhook-health.mjs
```

## Test it

```bash
pytest python/test_stripe_webhook_health.py
node --test node/stripe-webhook-health.test.mjs
```
