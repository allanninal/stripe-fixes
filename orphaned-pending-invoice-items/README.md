# pending invoice items that never reach an invoice

Somebody added a setup fee in March. It is still there, sitting in the account with invoice: null, waiting for the next invoice to sweep it up. That customer cancelled in April, so there will never be a next invoice, and the fee has been quietly not-billed for five months while showing up in nobody's report of anything.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/orphaned-pending-invoice-items/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_pending_invoice_items.py
node node/stripe-pending-invoice-items.mjs
```

## Test it

```bash
pytest python/test_stripe_pending_invoice_items.py
node --test node/stripe-pending-invoice-items.test.mjs
```
