# radar reviews sit open for days while funds stay at risk

Somebody added a review rule, which was the right instinct. The queue it feeds has forty-one items in it, the oldest is from three weeks ago, and nobody has opened the page since the week it was set up. Every one of those payments was already taken, and the ones that were not have quietly stopped being collectable.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/radar-reviews-open-stale/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_radar_review_queue.py
node node/stripe-radar-review-queue.mjs
```

## Test it

```bash
pytest python/test_stripe_radar_review_queue.py
node --test node/stripe-radar-review-queue.test.mjs
```
