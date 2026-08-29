# elevated-risk charges captured with no manual review

Disputes keep arriving for payments that went through weeks ago, and the chargeback rate is drifting toward the number the card networks care about. Open any one of them and Stripe already knew: the charge is marked elevated risk. Nobody was ever shown it, because nothing on the account was configured to show anybody anything.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/elevated-risk-charges-no-review/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_elevated_risk_review.py
node node/stripe-elevated-risk-review.mjs
```

## Test it

```bash
pytest python/test_stripe_elevated_risk_review.py
node --test node/stripe-elevated-risk-review.test.mjs
```
