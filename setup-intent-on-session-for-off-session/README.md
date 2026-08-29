# SetupIntents use on_session but you bill off-session

The card saves cleanly. It shows up on the customer, the last four digits are right, and if the customer comes back and pays with it themselves it works every time. The renewal that runs at three in the morning fails with authentication_required, and so does the one after that. The card is saved; it was never authorised for anyone but the customer to use.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/setup-intent-on-session-for-off-session/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_setup_intent_usage.py
node node/stripe-setup-intent-usage.mjs
```

## Test it

```bash
pytest python/test_stripe_setup_intent_usage.py
node --test node/stripe-setup-intent-usage.test.mjs
```
