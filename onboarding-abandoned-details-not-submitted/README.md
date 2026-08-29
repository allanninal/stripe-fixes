# accounts stall at details_submitted false after link expiry

Your database has four hundred acct_ rows and two hundred and ninety of them have never done anything at all. Support has a handful of tickets that all say some version of the same thing: the Stripe page said something went wrong, or the emailed link did nothing when they clicked it. Nobody connected the tickets to the rows, because the rows do not look like failures. They look like people who changed their minds.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/onboarding-abandoned-details-not-submitted/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_onboarding_stalled.py
node node/stripe-onboarding-stalled.mjs
```

## Test it

```bash
pytest python/test_stripe_onboarding_stalled.py
node --test node/stripe-onboarding-stalled.test.mjs
```
