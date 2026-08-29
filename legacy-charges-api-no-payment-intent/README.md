# charges have a null payment_intent, which means the legacy Charges API

European card volume declines at two or three times the rate of everything else, and nobody can find a cause. The cards are good. Radar is not blocking them. And 3D Secure never appears &mdash; not on a single one of these payments, ever, on any card from any issuer. That last detail is the whole diagnosis.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/legacy-charges-api-no-payment-intent/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_legacy_charges.py
node node/stripe-legacy-charges.mjs
```

## Test it

```bash
pytest python/test_stripe_legacy_charges.py
node --test node/stripe-legacy-charges.test.mjs
```
