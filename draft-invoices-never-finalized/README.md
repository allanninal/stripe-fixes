# draft invoices sit for months and never finalize

Somebody asks why the March figure is lower than the March that was forecast, and nobody can answer it from the Dashboard, because the money is not missing and it is not late. It is sitting in invoices that were built, itemised, priced correctly, and then never sent: no number, no PDF, no hosted page, no email. Stripe cannot collect on an invoice that has not been finalized, and these have been drafts since March.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/draft-invoices-never-finalized/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_draft_invoices.py
node node/stripe-draft-invoices.mjs
```

## Test it

```bash
pytest python/test_stripe_draft_invoices.py
node --test node/stripe-draft-invoices.test.mjs
```
