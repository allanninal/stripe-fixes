# off-session charges die on authentication_required

A renewal fails. The customer's card is fine, it has not expired, it has money on it, and it worked when they first signed up. You retry off-session and it fails identically, so you retry again on a schedule and it fails identically again. The decline_code is authentication_required, and no number of retries will ever change it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/off-session-authentication-required-declines/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_offsession_mandates.py
node node/stripe-offsession-mandates.mjs
```

## Test it

```bash
pytest python/test_stripe_offsession_mandates.py
node --test node/stripe-offsession-mandates.test.mjs
```
