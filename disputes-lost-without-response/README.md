# disputes closed as lost were never actually contested

Somebody finally asks what the dispute win rate is. The Dashboard says most of them are lost, and the conclusion in the room is that disputes are unwinnable and not worth the effort. Nobody in the room can say how many of those losses were ever answered, and until someone can, that conclusion is unsupported.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/disputes-lost-without-response/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dispute_forfeits.py
node node/stripe-dispute-forfeits.mjs
```

## Test it

```bash
pytest python/test_stripe_dispute_forfeits.py
node --test node/stripe-dispute-forfeits.test.mjs
```
