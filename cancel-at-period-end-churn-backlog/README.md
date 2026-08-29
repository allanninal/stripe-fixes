# active subscriptions already committed to cancel at period end

MRR is flat, the active-subscriber count is flat, and nothing in the billing data looks wrong. A month from now a fifth of it disappears in a week. The cancellations already happened; they just have not taken effect yet, and no report you have distinguishes a subscription that will renew from one that will not.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/cancel-at-period-end-churn-backlog/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_pending_churn.py
node node/stripe-pending-churn.mjs
```

## Test it

```bash
pytest python/test_stripe_pending_churn.py
node --test node/stripe-pending-churn.test.mjs
```
