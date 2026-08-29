# a second-currency balance bucket can never be paid out

The Stripe balance and the bank statements have been out by the same figure for months. It is not a rounding error and it is not a timing difference: it is a few hundred euros, on an account that pays out in dollars, sitting in a bucket that no payout has ever touched or ever will.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/stranded-currency-balance/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_stranded_currency.py
node node/stripe-stranded-currency.mjs
```

## Test it

```bash
pytest python/test_stripe_stranded_currency.py
node --test node/stripe-stranded-currency.test.mjs
```
