# no tax registrations while invoicing many countries

Stripe Tax is enabled. automatic_tax.status reads complete on every invoice. The tax line is zero on all of them, including the ones going to Germany and the UK, and the reason given is not_collecting. Nothing is failing. Stripe calculated the tax correctly, and the correct answer given the registrations on file is nothing.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/no-tax-registrations-while-selling-abroad/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_tax_registrations.py
node node/stripe-tax-registrations.mjs
```

## Test it

```bash
pytest python/test_stripe_tax_registrations.py
node --test node/stripe-tax-registrations.test.mjs
```
