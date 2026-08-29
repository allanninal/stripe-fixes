# highest-risk charges succeed instead of being blocked

The Radar page says the highest-risk block rule is on. It has been on since the account was created, nobody has touched it, and it is doing nothing. Somewhere below it is an allow rule that somebody added to stop blocking a partner's traffic, and an allow rule wins against everything, including Stripe's own defaults.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/highest-risk-charges-succeeded/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_highest_risk_succeeded.py
node node/stripe-highest-risk-succeeded.mjs
```

## Test it

```bash
pytest python/test_stripe_highest_risk_succeeded.py
node --test node/stripe-highest-risk-succeeded.test.mjs
```
