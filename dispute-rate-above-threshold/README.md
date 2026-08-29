# dispute activity is above the 0.75% excessive threshold

Nobody in the company can say what the dispute rate is. Individually the disputes look ordinary and each one gets handled on its own terms, so the trend never gets discussed. The first hard signal is an email from Stripe naming a card network monitoring programme, a fine, and a remediation plan with a deadline on it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/dispute-rate-above-threshold/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dispute_rate.py
node node/stripe-dispute-rate.mjs
```

## Test it

```bash
pytest python/test_stripe_dispute_rate.py
node --test node/stripe-dispute-rate.test.mjs
```
