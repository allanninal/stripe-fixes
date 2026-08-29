# nothing subscribes to disputes or early fraud warnings

The first anyone knows about a chargeback is an email from Stripe about a deadline, or an unexplained dip in the balance. By the time somebody opens the dashboard, several days of the evidence window are gone. Separately and more expensively, the order that caused it shipped a week ago, even though the issuer had already flagged the card.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/missing-dispute-and-fraud-events/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dispute_events.py
node node/stripe-dispute-events.mjs
```

## Test it

```bash
pytest python/test_stripe_dispute_events.py
node --test node/stripe-dispute-events.test.mjs
```
