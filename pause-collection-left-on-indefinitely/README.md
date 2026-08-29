# pause_collection with no resumes_at silently bills nothing

One customer had a bad month, support paused their billing for a while, and everybody moved on. That was in February. The subscription still reads active in every report you have, it still shows up in the subscriber count, and it has not produced a single invoice since.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/pause-collection-left-on-indefinitely/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_pause_collection.py
node node/stripe-pause-collection.mjs
```

## Test it

```bash
pytest python/test_stripe_pause_collection.py
node --test node/stripe-pause-collection.test.mjs
```
