# connect_reserved grows as connected accounts go negative

Payouts to the platform's own bank are smaller than the ledger says they should be, and the shortfall grows a little every month. No payout failed, no charge was refunded twice, and the Dashboard's headline balance looks plausible. The money is not missing &mdash; it is reserved, against connected accounts whose own balances have gone below zero.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/connect-reserved-balance-growing/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_connect_reserve.py
node node/stripe-connect-reserve.mjs
```

## Test it

```bash
pytest python/test_stripe_connect_reserve.py
node --test node/stripe-connect-reserve.test.mjs
```
