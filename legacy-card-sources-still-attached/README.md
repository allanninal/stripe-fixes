# legacy card sources still live under customer.sources

Half your customers renew without incident. The other half fail with Cannot charge a customer that has no active card, and when you open one of them in the Dashboard there is a card sitting right there. Both statements are true. The card is in a store the code that renews them cannot see.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/legacy-card-sources-still-attached/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_legacy_card_sources.py
node node/stripe-legacy-card-sources.mjs
```

## Test it

```bash
pytest python/test_stripe_legacy_card_sources.py
node --test node/stripe-legacy-card-sources.test.mjs
```
