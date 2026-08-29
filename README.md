# Stripe Fixes

Read-only Python and Node.js scripts that find Stripe integration problems through the API — disabled webhooks, undelivered events, stalled subscriptions and blocked payouts. They report and print the repair; they never write.

Every fix is safe by default. The scripts start in a dry run mode that reports what they would do, so you can read the plan before anything writes.

By **[Allan Niñal](https://github.com/allanninal)** — AI Solutions Engineer. I build AI powered tools, data products, and AWS automation.
Full write ups with diagrams for each fix live at **[allanninal.dev/stripe](https://www.allanninal.dev/stripe/)**.

[![Follow on GitHub](https://img.shields.io/github/followers/allanninal?label=Follow%20%40allanninal&style=social)](https://github.com/allanninal)
## The fixes

- [3DS handoff breaks and requires_action intents pile up](./abandoned-requires-action-intents/) — https://www.allanninal.dev/stripe/abandoned-requires-action-intents/
- [Checkout Sessions carry no ID that maps back to your order](./checkout-sessions-unreconcilable/) — https://www.allanninal.dev/stripe/checkout-sessions-unreconcilable/
- [a connected account sits with charges_enabled false](./connected-accounts-charges-disabled/) — https://www.allanninal.dev/stripe/connected-accounts-charges-disabled/
- [disputes are hours from due_by with no evidence attached](./dispute-deadline-72h-no-evidence/) — https://www.allanninal.dev/stripe/dispute-deadline-72h-no-evidence/
- [disputes closed as lost were never actually contested](./disputes-lost-without-response/) — https://www.allanninal.dev/stripe/disputes-lost-without-response/
- [duplicate customers share an email and split billing](./duplicate-customers-same-email/) — https://www.allanninal.dev/stripe/duplicate-customers-same-email/
- [two endpoints share one URL, so every event is handled twice](./duplicate-endpoints-same-url/) — https://www.allanninal.dev/stripe/duplicate-endpoints-same-url/
- [payout.failed is unsubscribed so failures go unseen for days](./missing-payout-failed/) — https://www.allanninal.dev/stripe/missing-payout-failed/
- [a connected account has no external account to pay out to](./no-external-account-attached/) — https://www.allanninal.dev/stripe/no-external-account-attached/
- [past_due subscriptions keep their access forever](./past-due-subscriptions-accumulating/) — https://www.allanninal.dev/stripe/past-due-subscriptions-accumulating/
- [payouts fail with account_closed and nobody is watching](./payouts-failing-bank-rejection/) — https://www.allanninal.dev/stripe/payouts-failing-bank-rejection/
- [radar blocks payments and nobody reads the block reasons](./radar-blocked-payments-ignored/) — https://www.allanninal.dev/stripe/radar-blocked-payments-ignored/
- [refunds sit failed or requires_action and nobody notices](./refunds-failed-or-stuck/) — https://www.allanninal.dev/stripe/refunds-failed-or-stuck/
- [requirements.past_due has already disabled the payouts](./requirements-past-due-disables-account/) — https://www.allanninal.dev/stripe/requirements-past-due-disables-account/
- [paymentIntents sit in requires_payment_method for weeks](./stale-requires-payment-method-intents/) — https://www.allanninal.dev/stripe/stale-requires-payment-method-intents/
- [active subscriptions with nothing to charge on renewal](./subscription-without-payment-method/) — https://www.allanninal.dev/stripe/subscription-without-payment-method/
- [incomplete subscriptions die silently after 23 hours](./subscriptions-stuck-incomplete/) — https://www.allanninal.dev/stripe/subscriptions-stuck-incomplete/
- [trials ending in days with no card on file](./trial-ends-without-payment-method/) — https://www.allanninal.dev/stripe/trial-ends-without-payment-method/
- [undelivered events are aging out of the 30-day window](./undelivered-events-nearing-retention/) — https://www.allanninal.dev/stripe/undelivered-events-nearing-retention/
- [a webhook endpoint sits disabled after days of retries](./webhook-endpoint-disabled/) — https://www.allanninal.dev/stripe/webhook-endpoint-disabled/
- [an endpoint subscribes to every event and floods the handler](./wildcard-enabled-events/) — https://www.allanninal.dev/stripe/wildcard-enabled-events/

## How to run one

Each folder holds the same script in Python and in Node.js, plus its test. Set the environment variables named in that folder's README, keep `DRY_RUN=true` for the first pass, and read what it reports before letting it write.

## License

MIT. Use it, change it, ship it.
