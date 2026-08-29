# payouts fail with account_closed and nobody is watching

The ledger says the payout was paid. The recipient says no money arrived. Both are true: the payout reached paid, the bank rejected the credit four days later, Stripe moved it to failed and returned the funds to your balance. Nothing in your system recorded the second half of that story, because nothing was reading the object after it went green.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payouts-failing-bank-rejection/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_failed_payouts.py
node node/stripe-failed-payouts.mjs
```

## Test it

```bash
pytest python/test_stripe_failed_payouts.py
node --test node/stripe-failed-payouts.test.mjs
```
