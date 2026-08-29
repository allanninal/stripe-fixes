# Stripe Fixes

Read-only Python and Node.js scripts that find Stripe integration problems through the API — disabled webhooks, undelivered events, stalled subscriptions and blocked payouts. They report and print the repair; they never write.

Every fix is safe by default. The scripts start in a dry run mode that reports what they would do, so you can read the plan before anything writes.

By **[Allan Niñal](https://github.com/allanninal)** — AI Solutions Engineer. I build AI powered tools, data products, and AWS automation.
Full write ups with diagrams for each fix live at **[allanninal.dev/stripe](https://www.allanninal.dev/stripe/)**.

[![Follow on GitHub](https://img.shields.io/github/followers/allanninal?label=Follow%20%40allanninal&style=social)](https://github.com/allanninal)
## The fixes

- [3DS handoff breaks and requires_action intents pile up](./abandoned-requires-action-intents/) — https://www.allanninal.dev/stripe/abandoned-requires-action-intents/
- [the platform collects zero application fees on its charges](./application-fees-zero-on-platform/) — https://www.allanninal.dev/stripe/application-fees-zero-on-platform/
- [automatic_tax is off on every invoice while selling abroad](./automatic-tax-disabled-everywhere/) — https://www.allanninal.dev/stripe/automatic-tax-disabled-everywhere/
- [charges captured after AVS and CVC verification failed](./avs-cvc-fail-captured/) — https://www.allanninal.dev/stripe/avs-cvc-fail-captured/
- [bank-debit intents stay in processing for over a week](./bank-debit-intents-stuck-processing/) — https://www.allanninal.dev/stripe/bank-debit-intents-stuck-processing/
- [no Billing Portal configuration, so portal sessions 400](./billing-portal-no-configuration/) — https://www.allanninal.dev/stripe/billing-portal-no-configuration/
- [active subscriptions already committed to cancel at period end](./cancel-at-period-end-churn-backlog/) — https://www.allanninal.dev/stripe/cancel-at-period-end-churn-backlog/
- [intents hardcode payment_method_types to card only](./card-only-payment-method-types/) — https://www.allanninal.dev/stripe/card-only-payment-method-types/
- [saved cards expire within 60 days and nothing warns anyone](./cards-expiring-within-60-days/) — https://www.allanninal.dev/stripe/cards-expiring-within-60-days/
- [session status is complete but payment_status is still unpaid](./checkout-complete-payment-unpaid/) — https://www.allanninal.dev/stripe/checkout-complete-payment-unpaid/
- [most Checkout Sessions expire unpaid and nobody is told](./checkout-expired-session-share/) — https://www.allanninal.dev/stripe/checkout-expired-session-share/
- [Checkout Sessions carry no ID that maps back to your order](./checkout-sessions-unreconcilable/) — https://www.allanninal.dev/stripe/checkout-sessions-unreconcilable/
- [connect_reserved grows as connected accounts go negative](./connect-reserved-balance-growing/) — https://www.allanninal.dev/stripe/connect-reserved-balance-growing/
- [a connected account sits with charges_enabled false](./connected-accounts-charges-disabled/) — https://www.allanninal.dev/stripe/connected-accounts-charges-disabled/
- [customers have no email, so Stripe sends no receipts](./customers-missing-email/) — https://www.allanninal.dev/stripe/customers-missing-email/
- [enabled_events lists event types that are dead or rejected](./dead-or-rejected-enabled-events/) — https://www.allanninal.dev/stripe/dead-or-rejected-enabled-events/
- [disputes are hours from due_by with no evidence attached](./dispute-deadline-72h-no-evidence/) — https://www.allanninal.dev/stripe/dispute-deadline-72h-no-evidence/
- [disputes closed as lost were never actually contested](./disputes-lost-without-response/) — https://www.allanninal.dev/stripe/disputes-lost-without-response/
- [draft invoices sit for months and never finalize](./draft-invoices-never-finalized/) — https://www.allanninal.dev/stripe/draft-invoices-never-finalized/
- [dunning ran out of retries and no attempt is scheduled](./dunning-retries-exhausted/) — https://www.allanninal.dev/stripe/dunning-retries-exhausted/
- [duplicate customers share an email and split billing](./duplicate-customers-same-email/) — https://www.allanninal.dev/stripe/duplicate-customers-same-email/
- [two endpoints share one URL, so every event is handled twice](./duplicate-endpoints-same-url/) — https://www.allanninal.dev/stripe/duplicate-endpoints-same-url/
- [a webhook endpoint is pinned to an ancient api_version](./endpoint-api-version-pinned-stale/) — https://www.allanninal.dev/stripe/endpoint-api-version-pinned-stale/
- [events still show pending_webhooks hours after they fired](./events-with-pending-webhooks/) — https://www.allanninal.dev/stripe/events-with-pending-webhooks/
- [manual-capture holds expire before anyone captures them](./expired-manual-capture-holds/) — https://www.allanninal.dev/stripe/expired-manual-capture-holds/
- [saved cards are already expired but still attached](./expired-saved-cards-attached/) — https://www.allanninal.dev/stripe/expired-saved-cards-attached/
- [highest-risk charges succeed instead of being blocked](./highest-risk-charges-succeeded/) — https://www.allanninal.dev/stripe/highest-risk-charges-succeeded/
- [legacy card sources still live under customer.sources](./legacy-card-sources-still-attached/) — https://www.allanninal.dev/stripe/legacy-card-sources-still-attached/
- [charges have a null payment_intent, which means the legacy Charges API](./legacy-charges-api-no-payment-intent/) — https://www.allanninal.dev/stripe/legacy-charges-api-no-payment-intent/
- [metered subscription items with no usage reported](./metered-items-with-no-usage-reported/) — https://www.allanninal.dev/stripe/metered-items-with-no-usage-reported/
- [nothing subscribes to disputes or early fraud warnings](./missing-dispute-and-fraud-events/) — https://www.allanninal.dev/stripe/missing-dispute-and-fraud-events/
- [payment-creating requests carry no idempotency key](./missing-idempotency-keys-on-payments/) — https://www.allanninal.dev/stripe/missing-idempotency-keys-on-payments/
- [payout.failed is unsubscribed so failures go unseen for days](./missing-payout-failed/) — https://www.allanninal.dev/stripe/missing-payout-failed/
- [no statement descriptor, so customers dispute what they see](./missing-statement-descriptor/) — https://www.allanninal.dev/stripe/missing-statement-descriptor/
- [customer.subscription.deleted is missing, so access never ends](./missing-subscription-deleted/) — https://www.allanninal.dev/stripe/missing-subscription-deleted/
- [a connected account has no external account to pay out to](./no-external-account-attached/) — https://www.allanninal.dev/stripe/no-external-account-attached/
- [live mode has no webhook endpoint, so nothing is ever pushed](./no-live-webhook-endpoints/) — https://www.allanninal.dev/stripe/no-live-webhook-endpoints/
- [no tax registrations while invoicing many countries](./no-tax-registrations-while-selling-abroad/) — https://www.allanninal.dev/stripe/no-tax-registrations-while-selling-abroad/
- [off-session charges die on authentication_required](./off-session-authentication-required-declines/) — https://www.allanninal.dev/stripe/off-session-authentication-required-declines/
- [accounts stall at details_submitted false after link expiry](./onboarding-abandoned-details-not-submitted/) — https://www.allanninal.dev/stripe/onboarding-abandoned-details-not-submitted/
- [open invoices are weeks past due_date and nobody chases](./open-invoices-past-due-date/) — https://www.allanninal.dev/stripe/open-invoices-past-due-date/
- [pending invoice items that never reach an invoice](./orphaned-pending-invoice-items/) — https://www.allanninal.dev/stripe/orphaned-pending-invoice-items/
- [past_due subscriptions keep their access forever](./past-due-subscriptions-accumulating/) — https://www.allanninal.dev/stripe/past-due-subscriptions-accumulating/
- [pause_collection with no resumes_at silently bills nothing](./pause-collection-left-on-indefinitely/) — https://www.allanninal.dev/stripe/pause-collection-left-on-indefinitely/
- [paused subscriptions never resume and never invoice again](./paused-subscriptions-never-resumed/) — https://www.allanninal.dev/stripe/paused-subscriptions-never-resumed/
- [a deactivated Payment Link is still linked from your site](./payment-link-inactive-still-published/) — https://www.allanninal.dev/stripe/payment-link-inactive-still-published/
- [payouts cannot be tied back to their balance transactions](./payout-reconciliation-unavailable/) — https://www.allanninal.dev/stripe/payout-reconciliation-unavailable/
- [a payout schedule left on manual strands the balance](./payout-schedule-left-on-manual/) — https://www.allanninal.dev/stripe/payout-schedule-left-on-manual/
- [payouts fail with account_closed and nobody is watching](./payouts-failing-bank-rejection/) — https://www.allanninal.dev/stripe/payouts-failing-bank-rejection/
- [prices left at tax_behavior unspecified break tax math](./prices-with-tax-behavior-unspecified/) — https://www.allanninal.dev/stripe/prices-with-tax-behavior-unspecified/
- [radar blocks payments and nobody reads the block reasons](./radar-blocked-payments-ignored/) — https://www.allanninal.dev/stripe/radar-blocked-payments-ignored/
- [radar reviews sit open for days while funds stay at risk](./radar-reviews-open-stale/) — https://www.allanninal.dev/stripe/radar-reviews-open-stale/
- [refunds sit failed or requires_action and nobody notices](./refunds-failed-or-stuck/) — https://www.allanninal.dev/stripe/refunds-failed-or-stuck/
- [requirements.past_due has already disabled the payouts](./requirements-past-due-disables-account/) — https://www.allanninal.dev/stripe/requirements-past-due-disables-account/
- [SetupIntents are created but never confirmed by the client](./setup-intents-never-confirmed/) — https://www.allanninal.dev/stripe/setup-intents-never-confirmed/
- [paymentIntents sit in requires_payment_method for weeks](./stale-requires-payment-method-intents/) — https://www.allanninal.dev/stripe/stale-requires-payment-method-intents/
- [a second-currency balance bucket can never be paid out](./stranded-currency-balance/) — https://www.allanninal.dev/stripe/stranded-currency-balance/
- [active subscriptions with nothing to charge on renewal](./subscription-without-payment-method/) — https://www.allanninal.dev/stripe/subscription-without-payment-method/
- [incomplete subscriptions die silently after 23 hours](./subscriptions-stuck-incomplete/) — https://www.allanninal.dev/stripe/subscriptions-stuck-incomplete/
- [live charges fail with testmode_decline from test cards](./testmode-decline-in-live-mode/) — https://www.allanninal.dev/stripe/testmode-decline-in-live-mode/
- [the transfers capability is inactive so every transfer 400s](./transfers-capability-inactive/) — https://www.allanninal.dev/stripe/transfers-capability-inactive/
- [trials ending in days with no card on file](./trial-ends-without-payment-method/) — https://www.allanninal.dev/stripe/trial-ends-without-payment-method/
- [PaymentMethods are created but never attached to a customer](./unattached-payment-methods-orphaned/) — https://www.allanninal.dev/stripe/unattached-payment-methods-orphaned/
- [undelivered events are aging out of the 30-day window](./undelivered-events-nearing-retention/) — https://www.allanninal.dev/stripe/undelivered-events-nearing-retention/
- [unpaid subscriptions keep access and stop billing entirely](./unpaid-subscriptions-still-provisioned/) — https://www.allanninal.dev/stripe/unpaid-subscriptions-still-provisioned/
- [requirements.errors explains the rejected document](./verification-errors-unread/) — https://www.allanninal.dev/stripe/verification-errors-unread/
- [no payment method domain registered, so wallets never show](./wallet-domain-not-registered/) — https://www.allanninal.dev/stripe/wallet-domain-not-registered/
- [a webhook endpoint sits disabled after days of retries](./webhook-endpoint-disabled/) — https://www.allanninal.dev/stripe/webhook-endpoint-disabled/
- [an endpoint subscribes to every event and floods the handler](./wildcard-enabled-events/) — https://www.allanninal.dev/stripe/wildcard-enabled-events/

## How to run one

Each folder holds the same script in Python and in Node.js, plus its test. Set the environment variables named in that folder's README, keep `DRY_RUN=true` for the first pass, and read what it reports before letting it write.

## License

MIT. Use it, change it, ship it.
