# subscriptions frozen on requires_action 3DS authentication

European signups convert worse than everyone else's and support has nothing to go on. The card is good, the customer entered it correctly, and the bank was ready to approve the payment as soon as somebody answered a question. Nobody asked them the question. The invoice is still open, waiting.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/sca-authentication-stuck-subscriptions/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_sca_stuck_subs.py
node node/stripe-sca-stuck-subs.mjs
```

## Test it

```bash
pytest python/test_stripe_sca_stuck_subs.py
node --test node/stripe-sca-stuck-subs.test.mjs
```
