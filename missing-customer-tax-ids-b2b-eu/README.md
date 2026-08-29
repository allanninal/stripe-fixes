# EU business invoices with no VAT number miss reverse charge

A German customer's finance team refuses the invoice. It has their company name on it, it has VAT added to it, and it has no VAT number and no reverse-charge notice anywhere on the document &mdash; so as far as their accounts payable is concerned it is a consumer receipt, and they cannot reclaim anything against it. Stripe did nothing wrong: with no tax ID on the customer, a business buyer is a consumer.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-customer-tax-ids-b2b-eu/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_eu_vat_ids.py
node node/stripe-eu-vat-ids.mjs
```

## Test it

```bash
pytest python/test_stripe_eu_vat_ids.py
node --test node/stripe-eu-vat-ids.test.mjs
```
