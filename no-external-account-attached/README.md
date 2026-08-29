# a connected account has no external account to pay out to

A seller has been taking payments for five months. Their Stripe balance is a five-figure number and it has only ever gone up. There are no failed payouts to investigate, no errors in any log, and no alert anywhere, for the simple reason that nothing has ever been attempted: the account has no bank account attached, so automatic payouts have nowhere to send the money.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/no-external-account-attached/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_missing_external_account.py
node node/stripe-missing-external-account.mjs
```

## Test it

```bash
pytest python/test_stripe_missing_external_account.py
node --test node/stripe-missing-external-account.test.mjs
```
