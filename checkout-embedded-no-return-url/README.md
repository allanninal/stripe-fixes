# embedded Checkout never redirects and return_url is null

The form is embedded in your own page, which is the whole point of it. Then a customer pays with iDEAL: they are sent to their bank, they authenticate, and they come back to nowhere, because return_url is null and the return leg has no destination. To them the payment failed. To Stripe it did not.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-embedded-no-return-url/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_checkout_return_urls.py
node node/stripe-checkout-return-urls.mjs
```

## Test it

```bash
pytest python/test_stripe_checkout_return_urls.py
node --test node/stripe-checkout-return-urls.test.mjs
```
