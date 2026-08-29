# saved cards are already expired but still attached

MRR leaks by a percent or two every month and the churn report calls it voluntary. It is not: these customers never chose to leave. Their saved card expired, the renewal failed with expired_card, the dunning emails went to an inbox they do not read, and the account settings page still shows the card as though it works.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/expired-saved-cards-attached/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_expired_cards.py
node node/stripe-expired-cards.mjs
```

## Test it

```bash
pytest python/test_stripe_expired_cards.py
node --test node/stripe-expired-cards.test.mjs
```
