# prices left at tax_behavior unspecified break tax math

Somebody turns on automatic tax and the first invoice refuses to take a line item. The price is fine, the product is fine, the amount is right, and Stripe will not compute tax on it, because tax_behavior is unspecified and it genuinely does not know whether the 20 EUR on that price already has VAT in it or not.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/prices-with-tax-behavior-unspecified/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_price_tax_behavior.py
node node/stripe-price-tax-behavior.mjs
```

## Test it

```bash
pytest python/test_stripe_price_tax_behavior.py
node --test node/stripe-price-tax-behavior.test.mjs
```
