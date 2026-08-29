# a bank account sits at status errored and payouts stop

A seller's payout failed in July. Somebody looked, saw one failure, assumed a temporary bank problem and moved on. It is now September, the seller's balance has grown to five figures, and there have been no further failed payouts at all &mdash; which is exactly what everyone took as evidence that the problem had resolved itself.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/external-account-errored/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_external_account_errored.py
node node/stripe-external-account-errored.mjs
```

## Test it

```bash
pytest python/test_stripe_external_account_errored.py
node --test node/stripe-external-account-errored.test.mjs
```
