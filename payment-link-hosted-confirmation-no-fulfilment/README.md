# Payment Link ends on Stripe's page, so fulfilment never fires

The link works. The money arrives. The customer sees a Stripe page thanking them, closes the tab, and waits for a licence key that no code was ever asked to send. Nothing failed anywhere: the flow simply ends on Stripe's side and never comes back to yours.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payment-link-hosted-confirmation-no-fulfilment/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payment_link_fulfilment.py
node node/stripe-payment-link-fulfilment.mjs
```

## Test it

```bash
pytest python/test_stripe_payment_link_fulfilment.py
node --test node/stripe-payment-link-fulfilment.test.mjs
```
