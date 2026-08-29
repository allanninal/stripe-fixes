# the endpoint listens for charge.succeeded, not payment_intent

This does not present as a webhook problem, because the webhook arrives. It presents as a data problem: the object in the payload has empty metadata, no customer, and nothing that maps the payment back to a cart or a user. The metadata is on the PaymentIntent. The endpoint is subscribed to the Charge.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/charge-events-but-paymentintent-integration/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_charge_event_drift.py
node node/stripe-charge-event-drift.mjs
```

## Test it

```bash
pytest python/test_stripe_charge_event_drift.py
node --test node/stripe-charge-event-drift.test.mjs
```
