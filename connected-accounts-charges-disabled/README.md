# a connected account sits with charges_enabled false

A seller emails support to say their checkout has been broken for two weeks. Nobody on the platform side saw anything: no alert, no failed job, no error in the logs. The platform's own Stripe account is healthy, payments are flowing, the graphs are flat and normal. The account that stopped working is one of four hundred, and the only field that would have told you is one nobody was reading.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/connected-accounts-charges-disabled/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_connect_charges_disabled.py
node node/stripe-connect-charges-disabled.mjs
```

## Test it

```bash
pytest python/test_stripe_connect_charges_disabled.py
node --test node/stripe-connect-charges-disabled.test.mjs
```
