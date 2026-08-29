# a deactivated Payment Link is still linked from your site

Somebody deactivated a Payment Link in the Dashboard six weeks ago, for a good reason. The URL is still in a landing page, a scheduled email and a PDF invoice template, and every customer who clicks it lands on a Stripe page explaining that the link is no longer active. Your server never hears about any of it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payment-link-inactive-still-published/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_inactive_payment_links.py
node node/stripe-inactive-payment-links.mjs
```

## Test it

```bash
pytest python/test_stripe_inactive_payment_links.py
node --test node/stripe-inactive-payment-links.test.mjs
```
