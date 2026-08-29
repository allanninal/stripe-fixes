# a webhook endpoint is pinned to an ancient api_version

The signature verifies. The event arrives. And then the object inside it is missing half the fields the current SDK expects, so the deserializer hands back an empty Optional or a null cast, and nobody throws anything. Fetching the same object straight from the API returns it complete, which makes the whole thing look like Stripe sending empty payloads.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/endpoint-api-version-pinned-stale/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_endpoint_api_version.py
node node/stripe-endpoint-api-version.mjs
```

## Test it

```bash
pytest python/test_stripe_endpoint_api_version.py
node --test node/stripe-endpoint-api-version.test.mjs
```
