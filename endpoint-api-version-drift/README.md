# endpoints render events at different pinned API versions

This is not one endpoint pinned to an ancient version, where every consumer at least agrees on the shape. This is two endpoints that disagree with each other. The same logical event goes to both, one service reads invoice.subscription and the other reads invoice.parent, and only one of them falls over. Both are configured exactly as somebody intended, six months apart.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/endpoint-api-version-drift/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_endpoint_version_drift.py
node node/stripe-endpoint-version-drift.mjs
```

## Test it

```bash
pytest python/test_stripe_endpoint_version_drift.py
node --test node/stripe-endpoint-version-drift.test.mjs
```
