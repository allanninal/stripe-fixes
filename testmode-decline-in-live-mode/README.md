# live charges fail with testmode_decline from test cards

A customer writes in to say their card was declined. You try it yourself with 4242&nbsp;4242&nbsp;4242&nbsp;4242 and it works fine, so you tell them to call their bank. It is not their bank. The charge failed with testmode_decline, which is Stripe saying that something in the request belonged to test mode and the request did not &mdash; and the card that &ldquo;works fine&rdquo; is the reason you cannot see it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/testmode-decline-in-live-mode/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_live_mode_check.py
node node/stripe-live-mode-check.mjs
```

## Test it

```bash
pytest python/test_stripe_live_mode_check.py
node --test node/stripe-live-mode-check.test.mjs
```
