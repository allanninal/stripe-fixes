# live mode has no webhook endpoint, so nothing is ever pushed

The first real payment arrives and the application does nothing with it. No order row, no fulfilment email, no account provisioned. The charge is right there in the Dashboard, marked succeeded. It all worked perfectly in development, every single time, because stripe listen was doing the delivering and nobody noticed that it was the only thing that ever had.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/no-live-webhook-endpoints/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_live_webhook_endpoints.py
node node/stripe-live-webhook-endpoints.mjs
```

## Test it

```bash
pytest python/test_stripe_live_webhook_endpoints.py
node --test node/stripe-live-webhook-endpoints.test.mjs
```
