# most Checkout Sessions expire unpaid and nobody is told

Sessions are being created at a healthy rate and the revenue line is flat. There is no error, no failed payment, no declined card &mdash; the sessions simply stop existing. Stripe does emit an event when one lapses, exactly 24 hours after it was created, and almost nobody is subscribed to it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-expired-session-share/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_checkout_abandonment.py
node node/stripe-checkout-abandonment.mjs
```

## Test it

```bash
pytest python/test_stripe_checkout_abandonment.py
node --test node/stripe-checkout-abandonment.test.mjs
```
