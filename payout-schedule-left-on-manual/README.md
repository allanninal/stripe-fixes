# a payout schedule left on manual strands the balance

A seller opens a ticket asking where four months of money went. Everything you check says the account is fine: payouts are enabled, no requirements are outstanding, a verified bank account is attached and set as the default. There are no failed payouts to investigate because there are no payouts at all, and the reason is a single string in a settings hash nobody has read since the platform was built.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payout-schedule-left-on-manual/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_manual_payout_schedule.py
node node/stripe-manual-payout-schedule.mjs
```

## Test it

```bash
pytest python/test_stripe_manual_payout_schedule.py
node --test node/stripe-manual-payout-schedule.test.mjs
```
