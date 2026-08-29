# reused idempotency keys hit 409 idempotency_key_in_use

The keys are being sent. That is what makes this different from payment requests with no key at all, where the header is simply absent. Here every request carries one, and the same one keeps turning up on requests that are not the same operation &mdash; so under load a slice of checkouts fails with 409 idempotency_key_in_use, and a day later the protection stops working entirely and the duplicates come back.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/idempotency-key-reuse-conflict/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_idempotency_key_reuse.py
node node/stripe-idempotency-key-reuse.mjs
```

## Test it

```bash
pytest python/test_stripe_idempotency_key_reuse.py
node --test node/stripe-idempotency-key-reuse.test.mjs
```
