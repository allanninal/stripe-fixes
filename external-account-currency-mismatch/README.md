# no external account can settle the account's currency

The payout call comes back with Sorry, you don't have any external accounts in that currency (usd). The account plainly has a bank account: you can see it in the Dashboard, the seller added it during onboarding, and it has been sitting there for months. It is an Australian bank account, the balance is in dollars, and there is no arrangement under which one settles the other.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/external-account-currency-mismatch/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_settlement_currency.py
node node/stripe-settlement-currency.mjs
```

## Test it

```bash
pytest python/test_stripe_settlement_currency.py
node --test node/stripe-settlement-currency.test.mjs
```
