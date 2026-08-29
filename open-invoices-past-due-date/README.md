# open invoices are weeks past due_date and nobody chases

Invoiced customers pay when they are asked twice. The integration asks once: Stripe emails the invoice on finalization and then waits, because that is what collection_method=send_invoice means. Nobody enabled the reminder emails, so an invoice that went out in April is still sitting at open in July, and the customer's subscription never noticed.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/open-invoices-past-due-date/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_overdue_invoices.py
node node/stripe-overdue-invoices.mjs
```

## Test it

```bash
pytest python/test_stripe_overdue_invoices.py
node --test node/stripe-overdue-invoices.test.mjs
```
