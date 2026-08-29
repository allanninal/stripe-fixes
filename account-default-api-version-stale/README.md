# account default API version is years behind the current one

Nothing on a webhook endpoint explains this one. The pinned-endpoint note is about a value you can read straight off the endpoint object; this is the account-wide default sitting underneath it, and there is no API endpoint anywhere that returns it. It is why a parameter copied out of the current documentation comes back as no such parameter, and why renewal invoices Stripe generates for you arrive in a shape from two years ago.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/account-default-api-version-stale/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_account_api_version.py
node node/stripe-account-api-version.mjs
```

## Test it

```bash
pytest python/test_stripe_account_api_version.py
node --test node/stripe-account-api-version.test.mjs
```
