# charges captured after AVS and CVC verification failed

The dispute says the cardholder never made the purchase, and when you open the charge to build a case you find the billing postal code did not match the issuer's records and the security code was wrong. Stripe recorded both facts at the time. Nothing was configured to act on them, so the payment was captured and the goods shipped.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/avs-cvc-fail-captured/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_avs_cvc_checks.py
node node/stripe-avs-cvc-checks.mjs
```

## Test it

```bash
pytest python/test_stripe_avs_cvc_checks.py
node --test node/stripe-avs-cvc-checks.test.mjs
```
