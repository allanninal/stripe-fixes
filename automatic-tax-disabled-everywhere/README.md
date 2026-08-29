# automatic_tax is off on every invoice while selling abroad

Stripe Tax was switched on eighteen months ago, the registrations were filed, and everyone moved on. The invoices going to Germany, France and the UK still carry no VAT, because enabling Tax in the Dashboard did nothing to the subscriptions the API had already created. Nothing errors. The totals are simply wrong, and the liability compounds every month.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/automatic-tax-disabled-everywhere/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_automatic_tax_off.py
node node/stripe-automatic-tax-off.mjs
```

## Test it

```bash
pytest python/test_stripe_automatic_tax_off.py
node --test node/stripe-automatic-tax-off.test.mjs
```
