# actionable early fraud warnings were never refunded

A batch of fraud disputes lands in the same week, all on charges from a month earlier. Each of those charges already carried an early fraud warning at the time, sitting in the API with actionable set to true, which is Stripe saying in as many words that you could still refund it. Nobody was subscribed to the event and nobody swept for it, so the window opened and closed unobserved.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/efw-actionable-not-refunded/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_efw_actionable.py
node node/stripe-efw-actionable.mjs
```

## Test it

```bash
pytest python/test_stripe_efw_actionable.py
node --test node/stripe-efw-actionable.test.mjs
```
