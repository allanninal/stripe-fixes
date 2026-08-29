# save_default_payment_method off orphans the card after payment

The signup works end to end. The customer enters a card, the first invoice is paid, the subscription goes active, and everyone moves on. A month later the renewal fails and the subscription has nothing on it to charge. The card that paid the first invoice is not gone &mdash; it was simply never made the subscription's default, because a flag nobody set defaults to off.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/save-default-payment-method-off/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_save_default_pm.py
node node/stripe-save-default-pm.mjs
```

## Test it

```bash
pytest python/test_stripe_save_default_pm.py
node --test node/stripe-save-default-pm.test.mjs
```
