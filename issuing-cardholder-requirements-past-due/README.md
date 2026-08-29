# cardholder requirements.past_due keeps every card inactive

The card was issued in the morning, handed to an employee at lunch, and declined at a card reader by two. The dashboard shows the card as inactive. Activating it does nothing. Nothing about the card object explains why, because the reason is not on the card &mdash; it is a list of two missing strings on the cardholder the card belongs to, one of which is an IP address.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/issuing-cardholder-requirements-past-due/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_issuing_cardholder_requirements.py
node node/stripe-issuing-cardholder-requirements.mjs
```

## Test it

```bash
pytest python/test_stripe_issuing_cardholder_requirements.py
node --test node/stripe-issuing-cardholder-requirements.test.mjs
```
