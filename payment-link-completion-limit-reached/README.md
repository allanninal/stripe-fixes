# payment link hit its completed-session limit and went dead

The campaign link worked. Fifty people bought through it and then the orders stopped, on a link nobody touched, in a week nobody deployed. The link is still active, still resolving, still in the email that goes out every morning. It reached the number of completed sessions it was created with and closed itself.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/payment-link-completion-limit-reached/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_payment_link_limits.py
node node/stripe-payment-link-limits.mjs
```

## Test it

```bash
pytest python/test_stripe_payment_link_limits.py
node --test node/stripe-payment-link-limits.test.mjs
```
