# the transfers capability is inactive so every transfer 400s

One seller's payouts never arrive. Their checkout works, the charges land on the platform, the account object says charges_enabled: true, and the seller's own balance stays at zero. Every attempt to move the money returns a 400 that names a capability nobody on the team has ever read a value from.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/transfers-capability-inactive/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_transfers_capability.py
node node/stripe-transfers-capability.mjs
```

## Test it

```bash
pytest python/test_stripe_transfers_capability.py
node --test node/stripe-transfers-capability.test.mjs
```
