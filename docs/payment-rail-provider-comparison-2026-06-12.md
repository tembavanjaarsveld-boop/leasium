# Payment Rail Provider Comparison - Ticket 2 Step 1

Date: 2026-06-12  
Audience: Temba / SKJ internal Leasium pilot  
Scope: compare Monoova, Zai, and Stripe Australia for rent/payment rail suitability.

## Decision Summary

No provider should be selected yet. Monoova and Zai are the stronger shortlist for an Australian rent collection rail because both cover PayTo, PayID/NPP, and BPAY patterns. Stripe AU is credible technically for PayTo and BECS Direct Debit, but it does not publicly present BPAY as an AU payment method and its pooled/net settlement model is the biggest trust-account question.

Recommendation for Ticket 2 Step 1:

1. Shortlist Monoova as the first provider to interrogate because its coverage maps most directly to Leasium's desired PayTo/PayID/BPAY rent collection shape, and its public rental examples imply low per-payment variable costs.
2. Keep Zai as a serious alternative, especially if its wallet/routing model can be confirmed as trust-compatible and pricing is acceptable for a small 44-tenancy operator.
3. Keep Stripe AU as a technical fallback for a narrow PayTo/BECS pilot only if BPAY is not mandatory and legal/accounting/provider answers clear the trust-account handling.
4. Do not create provider accounts, begin production onboarding, or accept provider terms until Temba has explicitly approved that step.

The Leasium adapter should be provider-neutral from day one: one internal payment/reconciliation contract, provider-specific adapters behind it, providers mocked in tests, and reconciliation actions kept review-first. Agents may draft provider questions and mocked implementation scaffolds, but must not create provider accounts, accept terms, send production payment instructions, reconcile money, email tenants, or mutate provider state without explicit operator approval.

## Comparison Matrix

| Area | Monoova | Zai | Stripe AU |
| --- | --- | --- | --- |
| Best read | Broad AU payment rail aggregator for PayTo, PayID/NPP, BPAY, direct debit, cards, wallets, and reconciliation tooling. | Embedded payments/orchestration provider with wallets, split/routed flows, PayTo, NPP/PayID, BPAY, direct debit, and cards. | Strong self-serve payments API for PayTo, AU BECS Direct Debit, and cards; not a full AU bill-pay suite. |
| PayTo | Strong fit for recurring rent. Customer-approved agreements, real-time settlement, sufficient-funds checks, failure/update notifications, agreement endpoints, and webhooks. | Supports one-off, ad hoc, and recurring PayTo via bank account or PayID, with customer banking approval and 24/7 real-time behaviour. Account reach is not universal. | Supports PayTo for AUD customers in Australia, one-off and recurring. Mandate authorisation can start from PayID or BSB/account details. |
| PayID / NPP | Supports PayID/NPP receipts and push-payment flows. Useful for tenant- or invoice-specific payment identifiers. | Supports NPP real-time pay-ins, per-user PayIDs, virtual BSB/account numbers, wallet matching. | PayID appears mainly as a PayTo mandate identifier path, not standalone PayID receivables in public docs. |
| BPAY | Supports BPAY with CRNs. Familiar for tenants, but push-only and slower. | Supports BPAY pay-ins and payouts. Pay-ins are pending before next-business-day settlement. | No public Stripe AU BPAY payment method found in the supplied research. |
| Other rails | Direct debit, cards, wallets. | Direct debit, cards, wallets, split/routed payments. | AU BECS Direct Debit and cards. |
| Public pricing / cost visibility | Partial. Standard pricing requires contact; setup, ancillary fees, and minimums may apply. Public rental table suggests Direct Debit <= A$0.25, PayTo <= A$0.40, BPAY <= A$0.40, cards <= 1.5% + A$0.25, but fixed costs may apply. | Partial. Card pricing is public at 1.5% + A$0.16 domestic and 2.8% + A$0.16 international. PayTo is described as flat fee, but PayTo/PayID/NPP/BPAY/monthly/minimum pricing is not public. | Strong. PayTo 1% + A$0.30 capped at A$3.50; AU BECS 1% + A$0.30 capped at A$3.50; domestic cards 1.7% + A$0.30. No setup/monthly fee in standard public pricing, optional Billing/Invoicing extra. |
| 44-tenancy cost signal | If 44 monthly collections use PayTo/BPAY at up to A$0.40, variable cost is up to about A$17.60/month before minimums and fixed fees. Direct Debit at up to A$0.25 would be about A$11/month before fixed fees. Not decision-grade until commercial terms are confirmed. | Cannot model SKJ cost until PayTo/PayID/NPP/BPAY, minimum, implementation, support, and contract fees are confirmed. | 44 monthly PayTo/BECS collections above the cap would be about A$154/month before optional extras. More visible, but likely materially more expensive than flat-fee rails. |
| Onboarding / KYC | Sales/onboarding-led. Permissions are set by Monoova. Monoova is an AFSL authorised representative and AUSTRAC reporting entity. Expect KYB, beneficial ownership, trust documents, bank verification, and AML checks. | Not quick self-serve. Pre-live contact with Sales. PayTo, virtual accounts, and PayIDs enabled by Zai. Production certification covers happy/unhappy paths, refunds, disputes, fraud, webhooks, AML, and user verification. | Normal Stripe merchant verification plus PayTo/BECS identity/KYC, ABN, local bank account, DDR/mandate compliance. Likely fastest to prototype technically if trust/BPAY questions do not block. |
| Settlement, webhooks, API | REST/JSON APIs, mAccounts, PayTo agreement endpoints, receivables reporting, and webhooks for NPP, PayTo, direct credit/debit clearance and dishonour, agreements, and payment instructions. PayTo/NPP instant or real-time; direct debit T+2; BPAY 1 to 3 business days. | REST workflows for wallets/items, PayTo agreements, payment initiation, transactions, batch transactions, virtual accounts, and PayIDs. Webhook signatures, HTTPS, retry; event order not guaranteed. Reconcile from current state, not event order alone. | Strong APIs and webhooks. PayTo final status typically within 60 seconds after mandate authorisation, but webhook-driven handling is required. BECS can take up to 3 business days; default AU settlement about 2 business days; first payout 7-14 days. |
| Trust-account concern | Customer funds are held in dedicated accounts separate from Monoova corporate funds and resulting trust if insolvent. However, Automatcher virtual account numbers are not separate accounts with balances, and funds end in the signed-in mAccount. Confirm statutory trust compatibility and direct settlement mechanics. | Stored Value Wallet is not a bank account; value is held by Cuscal in a pooled Customer Funds Account and is not FCS-covered. PDS includes a property-management sub-wallet example, but statutory trust suitability still needs legal/accounting confirmation. | Stripe pooled accounts and net-of-fees/disputes/refunds settlement may not fit strict real-estate trust workflows unless legal/accounting/provider review confirms gross settlement, fee handling, and refund/dispute treatment are acceptable. |
| SKJ 44-tenancy fit | Best apparent coverage fit. Commercial and compliance answers determine whether it is actually viable. | Good product/rail fit, but commercial opacity and wallet/trust mechanics need resolution before use. | Good developer experience and transparent pricing. Fit is narrow unless trust handling clears and BPAY is not required for the first phase. |

## Practical Decision

For Leasium's internal-first phase, the right decision is not "pick the easiest API". The gating issue is whether rent money can move in a way that Temba, SKJ's accountant, and the provider can defend as compatible with Queensland property trust-account obligations.

Monoova looks like the best first commercial conversation because it has the broadest direct rail match and the lowest visible variable-cost signal for 44 tenancies. Zai should stay close because its embedded-payments model may become useful if Leasium later needs routed payments, wallets, or richer marketplace-style flows. Stripe should not be discarded, but it should be treated as a PayTo/BECS technical fallback rather than the default AU rent rail because public BPAY coverage is absent and trust settlement is unresolved.

Decision gates before any provider commitment:

1. Written provider confirmation of trust-account suitability or a clear explanation of why the flow is not suitable.
2. Accountant/legal confirmation for the actual SKJ operating model.
3. Full commercial quote including monthly minimums, setup, PayTo, PayID/NPP, BPAY, failed payment, refund, payout, support, sandbox, and contract-term fees.
4. Confirmation that a 44-tenancy internal landlord/operator is acceptable volume and use case.
5. Sandbox availability and enough webhook/API detail to build an idempotent, review-first reconciliation adapter.

## Provider Q&A List

Ask every provider:

1. Can rent receipts settle gross into a nominated statutory trust account, with provider fees billed separately rather than netted from trust funds?
2. If funds touch a pooled account, wallet, mAccount, or customer funds account first, what is the legal character of those funds and how does that satisfy Queensland real-estate trust money requirements?
3. Can the provider support one tenant/payment reference per tenancy or invoice through PayID, virtual account, CRN, or another deterministic identifier?
4. What are the exact production fees for PayTo, PayID/NPP, BPAY, direct debit, failed payments, refunds, payouts, disputes, setup, monthly minimums, support, and sandbox access?
5. Is SKJ's 44-tenancy internal portfolio acceptable, or are there minimum volume, platform, marketplace, or multi-merchant requirements?
6. What tenant data is required for PayTo mandates and non-card collections, and what consent/DDR language must Leasium display or store?
7. What are the PayTo limits, bank reachability constraints, expected failure rates, and mandate update/cancellation flows?
8. Are webhook signatures, retries, replay protection, event IDs, and idempotency keys available for every rail?
9. Can Leasium fetch current provider state by API and reconcile from state, not only from webhook events?
10. What sandbox fixtures exist for successful payments, dishonours, mandate cancellations, expired agreements, duplicate events, delayed BPAY settlement, refunds, and disputes?
11. What reports are available for accountant review, audit trail, trust reconciliation, and CSV export?
12. Are there restrictions on commercial rent, property-management payments, trust money, or acting as a software layer for a single internal operator?

Monoova-specific:

1. What fixed monthly, setup, ancillary, failed-payment, refund, PayID, BPAY, and support fees apply beyond the public rental table?
2. Can PayTo, PayID/NPP, and BPAY receipts settle directly to SKJ's trust account, or must they first settle to a Monoova mAccount?
3. Are Automatcher virtual account numbers suitable for tenancy-level matching if they are not separate accounts with balances?
4. What webhook signing, retry, idempotency, and sandbox support is available for PayTo agreements and payment instructions?

Zai-specific:

1. What are the actual PayTo, PayID/NPP, BPAY, direct debit, payout, implementation, monthly minimum, support, sandbox, and contract-term fees?
2. Can the Stored Value Wallet / Cuscal Customer Funds Account model be used for statutory property trust money, or should Leasium avoid wallet custody entirely?
3. Can Zai support a single-landlord internal product, or is the product intended only for larger marketplaces/platforms?
4. What production certification steps and timelines should Leasium expect before first live rent collection?

Stripe-specific:

1. Is BPAY available for Australian Stripe accounts through any private, beta, partner, or enterprise path?
2. Can PayTo/BECS receipts be settled gross into a statutory trust account with fees charged separately?
3. How are refunds, disputes, negative balances, failed debits, and fee deductions handled when the connected bank account is a trust account?
4. Are commercial rent payments and property-management trust workflows acceptable under Stripe's services terms?

## Implementation Guardrails For Leasium

- Do not build provider-specific product assumptions into Leasium's domain model. Use a provider-neutral payment adapter contract and map provider events into Leasium's own payment, mandate, and reconciliation records.
- Tests must mock provider APIs, webhooks, and failure states. They must not call Monoova, Zai, Stripe, Xero, SendGrid, Twilio, banks, or payment rails.
- Provider webhooks should be stored idempotently and treated as evidence. They should not auto-reconcile trust money without an operator review/approve step.
- Reconciliation should remain review-first: extract provider/bank evidence, show confidence and source, let Temba approve/edit/ignore, then perform any allowed local state transition.
- Agents must not create provider accounts, submit onboarding/KYC details, accept provider terms, generate live credentials, or initiate live payment flows without explicit operator approval.

## Sources Preserved From Research

Monoova:
- https://www.monoova.com/receive-payments
- https://www.monoova.com/receive-payments/payto
- https://www.monoova.com/receive-payments/payid
- https://www.monoova.com/receive-payments/bpay
- https://www.monoova.com/industries/rental-collections
- https://www.monoova.com/api-faqs
- https://developer.monoova.com/webhooks
- https://www.monoova.com/legal
- https://www.auspayplus.com.au/solutions/payto-for-consumers

Zai:
- https://www.hellozai.com/pricing
- https://www.hellozai.com/payment-gateway
- https://developer.hellozai.com/docs/payto
- https://www.hellozai.com/payments/payto
- https://developer.hellozai.com/docs/webhooks
- https://developer.hellozai.com/docs/bpay-payins-workflow
- https://developer.hellozai.com/docs/payids-1
- https://www.hellozai.com/company/policies/combined-financial-services-guide-product-disclosure-statement-bpay-payment
- https://www.hellozai.com/company/policies/licences
- https://www.auspayplus.com.au/solutions/payto

Stripe:
- https://stripe.com/au/pricing
- https://stripe.com/au/pricing/local-payment-methods
- https://docs.stripe.com/payments/payto
- https://docs.stripe.com/payments/au-becs-debit
- https://docs.stripe.com/payments/balances
- https://docs.stripe.com/payouts/next-day-settlement
- https://docs.stripe.com/payments/payment-methods/payment-method-support
- https://stripe.com/legal/ssa-services-terms

Queensland trust-account guidance:
- https://www.qld.gov.au/law/laws-regulated-industries-and-accountability/queensland-laws-and-regulations/regulated-industries-and-licensing/regulated-industries-licensing-and-legislation/property-industry-regulation/managing-your-property-agency-or-business/dealing-with-trust-accounts-in-the-property-industry/handling-trust-money
- https://www.qld.gov.au/law/laws-regulated-industries-and-accountability/queensland-laws-and-regulations/regulated-industries-and-licensing/regulated-industries-licensing-and-legislation/property-industry-regulation/managing-your-property-agency-or-business/dealing-with-trust-accounts-in-the-property-industry/trust-accounts-for-the-property-motor-and-debt-collector-industry
