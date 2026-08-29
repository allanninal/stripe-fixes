# session status is complete but payment_status is still unpaid

The handler listens for checkout.session.completed, marks the order paid and ships it. Most of the time that is correct. For ACH, SEPA and every other delayed payment method it is a guess, and a few days later some of those guesses come back as checkout.session.async_payment_failed with the goods already gone.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/checkout-complete-payment-unpaid/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_unpaid_complete_sessions.py
node node/stripe-unpaid-complete-sessions.mjs
```

## Test it

```bash
pytest python/test_stripe_unpaid_complete_sessions.py
node --test node/stripe-unpaid-complete-sessions.test.mjs
```
