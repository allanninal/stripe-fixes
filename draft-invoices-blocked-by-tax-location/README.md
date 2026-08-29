# draft invoices blocked on customer_tax_location_invalid

A handful of customers have not been billed since Stripe Tax was switched on, and their subscriptions all read active. Their renewal invoices were created on schedule, priced correctly, and then refused at the last step: Stripe Tax cannot work out where the customer is, so it will not finalize the invoice, and an unfinalized invoice is never sent and never charged.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/draft-invoices-blocked-by-tax-location/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_tax_blocked_drafts.py
node node/stripe-tax-blocked-drafts.mjs
```

## Test it

```bash
pytest python/test_stripe_tax_blocked_drafts.py
node --test node/stripe-tax-blocked-drafts.test.mjs
```
