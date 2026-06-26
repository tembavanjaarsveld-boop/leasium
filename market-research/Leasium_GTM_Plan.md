# Leasium — GTM Plan & Pricing Strategy

Last updated: 2026-06-12
Companion to: `Leasium_Market_Sizing_Brief.md`, `Leasium_vs_PropertyMe_Strategy.md`,
`Leasium_vs_Different_Ailo_Teardown.md`, `Leasium_vs_ReLeased_Cost_Comparison.md`,
`Leasium_SEQ_Brisbane_Market.md`, `AU_Disruption_Opportunities.md`.

## Bottom line

The two-phase plan (self-managed first, PM channel second) is right. Two corrections to the pricing logic:

1. **$5/tenancy for self-managed is fine as a headline, but "cheap" is not the wedge there.** The competitor is the **agent's ~7.5% management fee (~$2,500–$4,000/yr/property)** and inertia — not another SaaS price. Even the nearest software comp (RentBetter) charges **$36/property/month**. At $5 you're already 7x under the software comp and ~40x under the agent. Going lower buys nothing; the risk is leaving expansion revenue (payments, commercial) unbuilt, since **$5 caps the entire 446k-tenancy segment at ~$27M ARR**.
2. **$3–4/door for PMs is not a low-cost entry — it's a premium price.** Incumbent agency software costs **$1.00–$2.40/door/month** (PropertyMe ~$1.35–1.49, Property Tree ~$1.30, Console ~$1.00–1.40, Kolmeo $2.10, Managed App $1.70–2.40). "Disrupt by price" inverts in this channel. Sell PMs **labour capacity, not software savings**: software is only ~1.2–2% of agency PM revenue, while staff are the crisis (35% PM churn, 97–136 doors/PM, margins down from 19.6%→12.8% FY21→FY24). $3–4/door is sellable — but as an ROI/automation story ("carry 200 doors per PM safely"), never as "cheaper than PropertyMe".

## 1. Competitive price map (June 2026, verified)

### Self-managed landlord tools (the segment's software comps)

| Product | Price | Effective $/property/mo | Notes |
|---|---|---|---|
| RentBetter (Manage) | $36/mo per property | $36 | Closest full-feature comp; $199 one-off REA/Domain listing |
| Cubbi (Assisted) | 2.33–3.28% of rent | ~$55–78 @ $550/wk | % of collections; listing $199 add-on |
| Instarent | $19.99 + $9.99/extra property + $0.99/txn | ~$10–20 | No listing syndication |
| RentingSmart | $10.49/mo up to 4 properties | ~$2.60 | Tracker only — no payments/listing |
| propkt | Free (1 property); $12/mo unlimited | ~$1–12 | Tracker only; aggressive free tier |
| Landlord Studio | ~US$12/mo (4 units) + US$1/unit | ~$3–5 | Not AU-localised |
| Traditional agent | ~7.5% rent + letting fees | ~$208–333 | The real competitor |

**Leasium at $5/tenancy sits in a gap:** above the trackers (which don't manage anything), 7x under RentBetter (which manages but has no AI/Xero/commercial depth), and ~2% of an agent. Price is credible, not the differentiator. Differentiators stay: document-first onboarding, Xero-open ledger, commercial depth, review-first AI.

### PM agency software

| Product | Pricing | Effective $/door/mo |
|---|---|---|
| PropertyMe | $149–215/mo incl. GST per 100 properties | ~$1.35–1.49 |
| Property Tree (MRI) | from $130/mo ex. GST per 100 | ~$1.30 |
| Console Cloud | ~$1.00–1.40/property, mins $225–350/mo | ~$1.00–1.40 |
| Kolmeo | $2.10/property ex. GST list | ~$1.60–2.10 |
| Managed App | $1.70 (Core) / $2.40 (Pro) per property, $170–240/mo min | $1.70–2.40 |
| Ailo | quote-only | est. $2–4 (unverified) |

Note Managed App's model: **trust-account-free** — tenant pays owner directly, monetised on payment flow. Legal precedent that matters for Leasium's PM entry (see §5).

## 2. Pricing architecture (recommended)

Keep the **per-tenancy unit** — transparent, scales fairly, and earns more on multi-tenancy commercial. Ladder it:

| Tier | Price | What it gates |
|---|---|---|
| **Free** | $0, 1 tenancy | Tracking, EOFY tax pack, Xero sync. PLG hook (propkt pattern) and the accountant-referral unit |
| **Core (resi)** | **$5/tenancy/mo** | Full management: Smart Intake onboarding, leases, compliance register, arrears, maintenance, tenant portal |
| **Plus (resi)** | $8–9/tenancy/mo | Payments (PayTo/BPAY auto-reconcile), unlimited AI intake, maintenance-partner network, priority support |
| **Commercial / mixed** | **$15–25/tenancy/mo** | Outgoings/CAM, CPI reviews, options, make-good, bank guarantees, compliance evidence. Comp is Re-Leased at an effective $18–72/unit/mo for small portfolios, quote-only with paid implementation — Leasium is still 3–10x cheaper at 4x resi ARPU. **This is the most underpriced part of the current plan; SKJ is the proof case** |
| Annual | 10 months (2 free) | Aligns to EOFY purchase moment |

**Non-subscription revenue (this is where the $5 cap breaks):**

- **Payments margin:** ~$1 per weekly rent collection ≈ **$52/tenancy/yr — roughly doubles resi ARPU** invisibly. Cubbi charges 2.33% of rent (~$670/yr) for the same job; Managed App's whole model is payment-flow monetisation. Tenant- or landlord-paid, framed as cheaper than anyone's dishonour/processing fees.
- **Listing syndication:** $199 one-off per vacancy (REA + Domain via licensed intermediary; partner cost ~$119–225 → thin margin but **the** acquisition hook — every vacancy is a landlord in market).
- **Pass-throughs with margin:** tenant checks (~$25), landlord insurance referral, depreciation schedule referral.

**Positioning the price:** never lead with "cheap" (trust-heavy category; too-cheap reads as risky). Lead with *"keep control and keep the fee — self-managing as easy as outsourcing"*; the price is the proof point. Consider founding-member framing ($5 locked for the first ~500 accounts) to preserve room to reprice Core at $7–8 later without breaking trust.

## 3. Unit economics and the TAM ceiling

- ARPU: 446k tenancies ÷ 194k owners = **2.3 tenancies/customer** → Core-only ARPU **$11.50/mo ($138/yr)**. With payments + Plus mix at maturity, plan blended **$15–20/mo**.
- Segment ceiling at $5 subscription only: 446k × $60 = **~$26.8M ARR at 100% share**; the model's 50% scenario = ~$13.4M; a realistic strong outcome (10–15%) = **$2.7–4M ARR**. Payments roughly doubles each figure; commercial tier and the 2.03M-door agency segment are the rest of the growth story. Conclusion: **$5 is a wedge price, not the business model.**
- LTV: at $15/mo blended, ~85% gross margin, 2%/mo churn → **~$640**. CAC target **<$200 blended**, payback <12 months. At $138/yr entry ARPU you cannot afford human-heavy support or paid-heavy acquisition: the funnel must be self-serve (which the document-first front door already is) with AI-first support.
- Brisbane beachhead: ~48k self-managed tenancies → $2.9M ARR ceiling at $5; the Phase-1 goal is proving **activation** (docs dropped → portfolio built → first rent reconciled), not revenue.

## 4. Go-to-market — self-managed (Phases 1–2)

**Trigger moments to own** (self-management decisions happen at events, not from ads):
vacancy/re-let · lease renewal & rent review · EOFY/tax time (July) · settlement of a new investment purchase · a bad agent experience (fee rise, PM churn — 35%/yr works in your favour).

**Channels, in priority order:**

1. **Product-led front door** — public "drop your lease pack → see your portfolio built" demo as the homepage. Free tier + free EOFY tax pack as the no-risk entry. Instrument the activation funnel; it is the whole game.
2. **SEO/content + free tools** — state-by-state compliance guides (rent increase rules, minimum standards, smoke alarms, bond lodgement), free generators (rent receipt, state-compliant rent-increase notice, lease checklist), "agent fee vs DIY" calculator. High-intent, low-competition keywords; compounding asset; the compliance-update cadence doubles as a retention feature.
3. **Listing syndication hook** — the RentBetter "Match" pattern: $199 listing lands the landlord at their highest-pain moment, the platform converts them to subscription. Requires a licensed-agency syndication partner (or licence) — start the partner conversation early.
4. **Xero App Store + accountant channel** — Leasium is Xero-native; list early. Property-specialist accountants, depreciation firms (BMT, Duo Tax), buyer's agents and mortgage brokers all touch the landlord at trigger moments; pay a simple referral (e.g., 3 months free + bounty). The Free tier is the giveable unit.
5. **Community/founder-led** — PropertyChat, property-investor Facebook groups, r/AusProperty: teardown content (real fee maths, compliance traps), not ads. Credible because SKJ self-manages a real portfolio on it.
6. **Paid (small, later)** — Google Ads on "self manage rental property / private landlord <state>" only after organic conversion is known; cap at CAC target.
7. **Partnerships** — landlord insurers (EBM RentCover, Terri Scheer), tenant-check providers; bundle, don't build.

**Sequencing & targets (indicative):**

| Phase | When | Goal | Success looks like |
|---|---|---|---|
| 0 — Internal | now → ~Q4 2026 | Harden on SKJ portfolio (per internal-first call) | Smart Intake accurate on real third-party docs; payments rail picked |
| 1 — Beachhead | ~Q4 2026 → Q1 2027 | 15–30 Brisbane design partners (commercial/mixed first, then resi), white-glove | >70% docs→portfolio activation; first rent reconciled <14 days; 10+ referenceable owners |
| 2 — Self-serve launch | ~Q1–Q2 2027 | Public launch + listing hook + **EOFY July 2027 campaign** | 500–1,000 customers / ~2,000+ tenancies by end 2027; blended CAC <$200; logo churn <2.5%/mo |
| 3 — PM channel pilot | 2027 H2+ | 3–5 boutique/new agencies (see §5) | Paid pilots at $3–4/door; one public case study on doors-per-PM uplift |

## 5. PM channel (Phase 3) — premium play, with a structural wedge

- **Price:** hold **$3–4/door/mo as a premium**, floor at $2.50 in negotiation. The ROI story: lifting capacity from ~120 to ~180–200 doors/PM returns roughly half an FTE (~$40–50k/yr) per 360 doors ≈ **$9–12/door/mo of value** — 3x the price. Macquarie's data (margins 12.8% and falling, salaries +24% in FY24) is the deck slide.
- **Entry segment: new and boutique agencies, not PropertyMe's installed base.** 35% PM churn and 40% of principals planning exit means a steady stream of PMs starting their own rent rolls: no legacy data (Smart Intake is the onboarding), no trust-account lock-in, modern expectations. Rent-roll buyers post-acquisition are the second entry (migration = document drop).
- **The trust-accounting gate, addressed:** Leasium has no trust accounting and should not build it first (per the PropertyMe doc — that's cloning the moat). **Managed App has proven the trust-account-free agency model is legally viable in AU** (tenant→owner direct flow). Leasium's PM entry is the same shape: *"run your rent roll without a trust account"* — direct PayTo flows, review-first reconciliation, Xero-open. Validate the legal position per state before the pilot; build statutory trust accounting only if/when moving upmarket demands it.
- Borrow Ailo's bar: real-time NPP money + owner-app transparency is the experience standard the pilot must meet.

## 6. Risks and open questions

- **Demand-side risk remains #1:** the self-management rate (25–33%) and owners' willingness to switch from inertia. Mitigation: trigger-moment channels + the listing hook intercepting owners already in motion. Track conversion at each trigger.
- **Support load at $138/yr ARPU** — compliance questions are support-heavy. AI-first support + state compliance content as deflection; watch tickets/customer monthly.
- **REA/Domain access is gated** via licensed intermediaries — dependency risk on the acquisition hook. Secure the partner (or a licence) before Phase 2.
- **Payments margin is load-bearing** in the model — if PayTo economics don't support ~$1/collection, the $5 headline needs to move toward $7–8. Decide after rail selection (Monoova/Zai/Stripe AU).
- **PropertyMe "self-manager lite"** response: possible, fights their DNA; speed + commercial depth is the answer.
- **Too-cheap perception** in a trust category — mitigated by founding-member framing and visible security/review-first posture.
- Open: per-tenancy vs per-property labelling for resi (identical in practice; "per property" may read simpler to owners — test copy, keep per-tenancy billing under the hood). Strata adjacency (`AU_Disruption_Opportunities.md`) stays parked until Phase 2 is proven.

## 7. First 90 days (GTM workstream, alongside product Phase 0)

1. Lock pricing v1 (this doc → decision): Free / $5 Core / Plus / commercial tier / $199 listing / annual.
2. Pick the payments rail and model the per-collection margin — confirms or moves the $5.
3. Start the listing-syndication partner conversation (licensed intermediary).
4. Ship the public front door: doc-drop demo + Free tier + EOFY tax pack lead magnet; instrument the activation funnel.
5. Write the first 6 state-compliance SEO pieces + the agent-fee calculator.
6. Recruit the first 5 Brisbane design partners (commercial/mixed first — SKJ's network).
7. Apply to the Xero App Store.
8. Validate the trust-account-free legal position (QLD first) so the Phase-3 wedge is real before any agency conversation.

## Sources

- RentBetter pricing — https://rentbetter.com.au/pricing
- Cubbi pricing — https://www.cubbi.com.au/assisted-management/pricing
- Instarent pricing — https://www.instarent.com.au/price/
- RentingSmart pricing — https://rentingsmart.com.au/pricing
- propkt — https://propkt.com
- Landlord Studio pricing — https://www.landlordstudio.com/pricing
- PropertyMe pricing — https://www.propertyme.com.au/pricing
- Property Tree pricing — https://www.mrisoftware.com/au/products/property-tree/pricing/
- Console Cloud pricing — https://www.console.com.au/pricing
- Managed App pricing — https://managedapp.com.au/pricing
- Kolmeo — https://kolmeo.com/agencies
- Re-Leased AU — https://www.re-leased.com/en-au/pricing
- Macquarie Bank Real Estate Benchmarking Report 2024 — https://www.macquarie.com.au/assets/bfs/documents/business-banking/bb-real-estate-industry/macquarie-bank-real-estate-benchmarking-report-2024.pdf
- Management fee benchmarks — https://www.houst.com/blog/rental-property-management-fees ; DHA/Oxford Economics fee comparison (Jan 2025)
- PM staff churn — https://www.worthrecruiting.me/blog/2026/02/the-great-property-management-exodus-why-talent-is-walking-away
- Private-landlord REA/Domain listing — https://www.salebyhomeowner.com.au/packages/rental-package/
- Internal: `Leasium_Market_Sizing_Brief.md` (ATO-based segment model), `Leasium_vs_PropertyMe_Strategy.md`, `Leasium_vs_Different_Ailo_Teardown.md`, `Leasium_vs_ReLeased_Cost_Comparison.md`
