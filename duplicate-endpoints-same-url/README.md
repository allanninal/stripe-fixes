# two endpoints share one URL, so every event is handled twice

Two order rows for one payment. Two fulfilment emails. A customer credited twice. The handler reads correctly, it passes its tests, and it does not misbehave locally &mdash; because locally there is one endpoint, and in production there are two pointing at the same URL.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/duplicate-endpoints-same-url/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_duplicate_endpoints.py
node node/stripe-duplicate-endpoints.mjs
```

## Test it

```bash
pytest python/test_stripe_duplicate_endpoints.py
node --test node/stripe-duplicate-endpoints.test.mjs
```
