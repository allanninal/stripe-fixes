# a live webhook endpoint points at a dev tunnel or http

It worked for exactly one afternoon. The endpoint was registered during a development session, against a tunnel that happened to be running at the time; the tunnel was closed at the end of the day and the hostname stopped resolving. Every delivery attempt since then has failed before it reached any code you wrote.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/non-https-or-tunnel-webhook-url/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_webhook_url_check.py
node node/stripe-webhook-url-check.mjs
```

## Test it

```bash
pytest python/test_stripe_webhook_url_check.py
node --test node/stripe-webhook-url-check.test.mjs
```
