# saved cards expire within 60 days and nothing warns anyone

The churn chart has lumps in it, and the lumps are always at the end of a month. Nobody cancelled. Their card expired, the renewal declined, and the first the customer heard about it was a failed-payment email that reads like an accusation. The expiry date was sitting in the API from the day they saved the card.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/cards-expiring-within-60-days/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_card_expiry_window.py
node node/stripe-card-expiry-window.mjs
```

## Test it

```bash
pytest python/test_stripe_card_expiry_window.py
node --test node/stripe-card-expiry-window.test.mjs
```
