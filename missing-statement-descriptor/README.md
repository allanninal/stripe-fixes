# no statement descriptor, so customers dispute what they see

Every month a handful of disputes arrive with the reason unrecognized or duplicate, from customers who bought the thing, kept the thing, and are perfectly happy with it. They looked at a bank statement, saw a line that meant nothing to them, and did the sensible thing. You pay the dispute fee for each one.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-statement-descriptor/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_statement_descriptor.py
node node/stripe-statement-descriptor.mjs
```

## Test it

```bash
pytest python/test_stripe_statement_descriptor.py
node --test node/stripe-statement-descriptor.test.mjs
```
