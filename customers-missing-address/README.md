# customers have no address, so tax and SCA exemptions fail

An invoice will not finalize. The error is customer_tax_location_invalid, which sounds like a Stripe Tax configuration problem and is not: the registrations are fine, the rates are fine, and the customer simply has no address on file. Your own database has their shipping address. Stripe's copy of the Customer has address: null, and it has been that way since the integration was written.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/customers-missing-address/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_customer_address.py
node node/stripe-customer-address.mjs
```

## Test it

```bash
pytest python/test_stripe_customer_address.py
node --test node/stripe-customer-address.test.mjs
```
