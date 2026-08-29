# payouts cannot be tied back to their balance transactions

A single deposit arrives in the bank and finance asks the only reasonable question: what is in it? The obvious answer, GET /v1/balance_transactions?payout=po_x, comes back with an empty list. Not an error, not a permissions problem &mdash; an empty list, on a payout that definitely happened.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payout-reconciliation-unavailable/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payout_reconciliation.py
node node/stripe-payout-reconciliation.mjs
```

## Test it

```bash
pytest python/test_stripe_payout_reconciliation.py
node --test node/stripe-payout-reconciliation.test.mjs
```
