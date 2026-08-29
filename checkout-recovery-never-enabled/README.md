# expired Checkout Sessions are never recovered by email

Somebody asks why there is no abandoned-cart email. The answer is not that nobody built one. It is that there is nothing to send: Checkout will mint a recovery link for every session that lapses, but only for sessions created with recovery switched on, and switching it on afterwards does nothing at all.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-recovery-never-enabled/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_checkout_recovery.py
node node/stripe-checkout-recovery.mjs
```

## Test it

```bash
pytest python/test_stripe_checkout_recovery.py
node --test node/stripe-checkout-recovery.test.mjs
```
