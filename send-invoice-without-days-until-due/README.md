# invoiced subscriptions with no days_until_due never age

The finance team asks for an aged receivables report and the answer comes back empty, which everyone reads as good news. It is not: these invoices are not current, they are undateable. days_until_due was never set on the subscriptions that generate them, so Stripe writes each invoice with due_date null, and an invoice with no due date cannot be overdue, cannot trigger a reminder, and cannot age into any bucket at all.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/send-invoice-without-days-until-due/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_days_until_due.py
node node/stripe-days-until-due.mjs
```

## Test it

```bash
pytest python/test_stripe_days_until_due.py
node --test node/stripe-days-until-due.test.mjs
```
