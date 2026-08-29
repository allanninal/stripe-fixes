# requirements.errors explains the rejected document

A seller has uploaded the same photo of their passport four times over two weeks. Your onboarding UI has said verification pending every time, because that is the only string it knows. Stripe has been returning the specific reason since the first attempt: the scan is greyscale. Nobody has ever read the field it is in, so the seller keeps sending the file that cannot pass.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/verification-errors-unread/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_verification_errors.py
node node/stripe-verification-errors.mjs
```

## Test it

```bash
pytest python/test_stripe_verification_errors.py
node --test node/stripe-verification-errors.test.mjs
```
