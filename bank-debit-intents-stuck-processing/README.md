# bank-debit intents stay in processing for over a week

Bank-debit orders divide into two piles and neither is right. Some shipped the moment the customer clicked, and a few of those later bounced. The rest have never shipped at all, because nothing in the code ever looked at them again. The intents are all sitting in processing, which is where an ACH payment is supposed to sit &mdash; for a while.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/bank-debit-intents-stuck-processing/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_bank_debit_processing.py
node node/stripe-bank-debit-processing.mjs
```

## Test it

```bash
pytest python/test_stripe_bank_debit_processing.py
node --test node/stripe-bank-debit-processing.test.mjs
```
