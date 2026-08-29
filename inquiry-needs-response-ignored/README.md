# inquiries sit unanswered and escalate into chargebacks

Chargebacks appear to arrive from nowhere. Somebody pulls the history for one of them and finds it was visible in the API eleven days earlier, as an inquiry, with a deadline and a place to put evidence. Nothing was wrong with the alerting: the sweep looked for disputes whose status was needs_response, and at that point the status was warning_needs_response.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/inquiry-needs-response-ignored/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_dispute_inquiries.py
node node/stripe-dispute-inquiries.mjs
```

## Test it

```bash
pytest python/test_stripe_dispute_inquiries.py
node --test node/stripe-dispute-inquiries.test.mjs
```
