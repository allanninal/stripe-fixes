# terminal readers sit offline and take no payments

A shop's card takings were zero all weekend. There is nothing in the Dashboard to look at: no declines, no failed PaymentIntents, no errors. That is the tell. A reader that is offline does not fail payments, it never starts them, so the evidence of the outage is an absence of records rather than a list of them.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/terminal-readers-offline/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_terminal_readers.py
node node/stripe-terminal-readers.mjs
```

## Test it

```bash
pytest python/test_stripe_terminal_readers.py
node --test node/stripe-terminal-readers.test.mjs
```
