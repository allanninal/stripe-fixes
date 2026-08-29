# no payment method domain registered, so wallets never show

Apple Pay renders perfectly on localhost. It renders in Stripe's own demo. It is enabled in the Dashboard, the browser is Safari, the device has a card in the wallet &mdash; and on checkout.example.com the button is simply not there. No console error, no failed request, nothing in the Stripe logs. The wallet was filtered out before it had a chance to render, because Stripe does not recognise the domain asking for it.

**Full guide with diagrams:** https://www.allanninal.dev/stripe/wallet-domain-not-registered/

## Run it

```bash
export DRY_RUN="true"   # report only, write nothing
python python/stripe_wallet_domains.py
node node/stripe-wallet-domains.mjs
```

## Test it

```bash
pytest python/test_stripe_wallet_domains.py
node --test node/stripe-wallet-domains.test.mjs
```
