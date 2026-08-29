# SetupIntents are created but never confirmed by the client

Support keeps hearing the same thing: they added a card, the page said it worked, and the next invoice failed anyway. In the API there are four hundred SetupIntents sitting at requires_confirmation, created over three months, none of which ever produced a mandate or a PaymentMethod on a Customer.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/setup-intents-never-confirmed/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_setup_intents_stuck.py
node node/stripe-setup-intents-stuck.mjs
```

## Test it

```bash
pytest python/test_stripe_setup_intents_stuck.py
node --test node/stripe-setup-intents-stuck.test.mjs
```
