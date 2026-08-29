# elevated-risk card charges are captured with no 3DS

Fraud disputes on card-not-present payments are being lost one after another, and each response comes back the same way. Somebody checks whether the liability shift applies and finds that none of the disputed charges went through 3D Secure at all: payment_method_details.card.three_d_secure is null on every one, including the ones Radar had already scored as elevated risk.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/no-3ds-on-elevated-risk/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_3ds_coverage.py
node node/stripe-3ds-coverage.mjs
```

## Test it

```bash
pytest python/test_stripe_3ds_coverage.py
node --test node/stripe-3ds-coverage.test.mjs
```
