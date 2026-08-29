# disputes are hours from due_by with no evidence attached

A customer disputed a charge three weeks ago. The notification went to the shared billing inbox, where it sat under invoices. The dispute closed yesterday as lost, the funds went back, the dispute fee did not come back, and the delivery confirmation that would have answered it was in a support ticket the whole time.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/dispute-deadline-72h-no-evidence/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dispute_deadlines.py
node node/stripe-dispute-deadlines.mjs
```

## Test it

```bash
pytest python/test_stripe_dispute_deadlines.py
node --test node/stripe-dispute-deadlines.test.mjs
```
