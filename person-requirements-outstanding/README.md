# a Person's currently_due blocks the whole account

The seller filled in everything your onboarding form asked for. The account object shows a business name, an address, a tax id and a bank account, and charges_enabled is still false. The one thing in requirements.currently_due is a string that starts person_1Mq and ends .verification.document, and there is no field anywhere in your product that corresponds to it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/person-requirements-outstanding/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_person_requirements.py
node node/stripe-person-requirements.mjs
```

## Test it

```bash
pytest python/test_stripe_person_requirements.py
node --test node/stripe-person-requirements.test.mjs
```
