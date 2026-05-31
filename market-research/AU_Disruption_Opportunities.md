# AU Disruption Opportunities — "DoorLoop Arbitrage" Scan

Last updated: 2026-05-31
Companion to: `Leasium_vs_PropertyMe_Strategy.md`, `Leasium_vs_Different_Ailo_Teardown.md`,
`Leasium_Market_Sizing_Brief.md`.

## The play

Find SMB verticals where a **modern (usually US/global) disruptor** has proven the model, but
**Australia still overpays for legacy/desktop/quote-based tech**, and **no AU player has yet shipped
the transparent, self-serve, AU-localised version** — then build it (NPP/PayTo, ATO/ABN, state
compliance = the moat). This is the DoorLoop→PropertyMe pattern, applied to the next vertical.

## The honest filter: most easy gaps are already taken

A scan kills the lazy answers fast. AU-born or AU-localised disruptors have **already closed** many
obvious gaps: **Xero** (accounting), **ServiceM8/Tradify** (trades, from $29–35/mo), **Cliniko/Power
Diary** (allied health), **Praktika/Halaxy** (dental/GP cloud), **ShiftCare/Brevity** (NDIS, $6–9),
**Hapana** (fitness). So "copy a US SaaS" alone isn't a moat here — Australians copy fast too.

**The durable arbitrage is narrower:** verticals where the incumbent is legacy **and** entrenched/
consolidated **and** the category carries a **trust-accounting / state-regulatory moat** that (a) keeps
generic SaaS out and (b) is precisely what Leasium already does. That points at **property-and-finance
adjacencies**, not random verticals.

## Ranked shortlist

| Vertical | Modern disruptor (proof) | AU legacy incumbent (overpay signal) | Gap status | Fit to Leasium |
|---|---|---|---|---|
| **Strata / body corporate** | US HOA: DoorLoop/AppFolio | **StrataMax** (650k lots, quote-only + implementation projects), **MRI Strata Master** (legacy, enterprise) | **Partly open** — Urbanise is cloud but enterprise; no DoorLoop-style self-serve for *small* strata | ⭐⭐⭐ near-identical stack (trust accounting, levies, owner portals, maintenance, AU state law) |
| **Conveyancing / small-firm legal** | Clio (global) | **LEAP** ("aging, not cloud-native, expensive, poor support") + a **consolidated** market (LEAP+Smokeball+InfoTrack one owner; Actionstep forcing FilePro/LawMaster migrations w/ tens-of-thousands implementation) | **Open-ish** — Clio modern but the AU-localised (PEXA e-conveyancing, AU trust) self-serve for *small* firms is thin | ⭐⭐ document-AI + trust accounting reuse; a pivot, not an adjacency |
| **GP / dental practice mgmt** | US cloud (Curve, tab32); AU Halaxy/Praktika | **Best Practice** (~60% GP share, on-premise) + **Medical Director** (desktop); **Dental4Windows** (on-premise #1). Overpay = servers + IT contracts + per-practitioner licences | Legacy still dominant, **but** modern AU challengers exist + clinical-safety regulation = slow build | ⭐ big overpay, but clinical/regulated = **not** a quick build, and not document/finance-adjacent |
| **NDIS / community care** | — | Manual/legacy + Lumary (enterprise) | **Closing** — ShiftCare ($9/user), Brevity ($6.49/client) already modern + cheap | ⭐ crowded; AU-specific reg moat but already contested |
| **Trades / field service** | US: Jobber/ServiceTitan | AroFlo/simPRO (mid-market) | **Closed** — ServiceM8/Tradify already own SMB at $29–35/mo | — partner with (maintenance network), don't build |
| **Gym / studio** | Glofox, Mariana Tek | **Mindbody** (AUD $195–900+/mo, clunky legacy, poor support) | **Contested** — Hapana (AU), Glofox, Clubworx, Vibefam already modern | — real overpay, poor fit (consumer-booking, no finance/compliance moat) |

## Top tier — where SKJ should actually look

### 1. Strata / body corporate — the true adjacency (highest ROI)
This is **"Leasium for apartment buildings."** A body-corporate manager needs: trust accounting,
levy (rent-equivalent) billing, owner (lot-owner) portals, maintenance/work orders, compliance, AGM/
voting, document management — **almost exactly Leasium's existing stack**, re-skinned. The incumbents
(StrataMax, MRI Strata Master) are legacy and **quote-only with paid implementation projects** — the
same floor-plus-setup wall Re-Leased and PropertyMe have. AU strata is huge and growing (apartment
living), and every state has its own Strata/Owners-Corporation Act → the **localisation moat** that
keeps US players out is one Leasium already pays. Biggest reuse of code + market knowledge of any
option; the main new surface is levies/AGM/voting. **This is the standout.**

### 2. Conveyancing / small-firm legal trust — the document-AI pivot
The AU legal-software market is **legacy and consolidating into one owner** (LEAP/Smokeball/InfoTrack),
with firms reporting being "abandoned" and overpaying, and Actionstep force-migrating FilePro/LawMaster
users at tens-of-thousands implementation cost. Conveyancing specifically is **document- and
process-driven with trust accounting and PEXA e-settlement** — i.e., Leasium's document-AI (drop the
contract → matter + dates + trust ledger) + trust-accounting strengths transfer directly. It's a pivot
(new buyer: small conveyancers/solicitors), but the moat (AU trust + PEXA + state law) is real and the
incumbent is weak and expensive. Strong #2.

## Second tier — big overpay, but slower/harder
- **GP / dental / specialist practice management.** The clearest *raw* "AU still on desktop" overpay
  (Best Practice ~60% on-premise; Dental4Windows on-premise #1; servers + IT + per-seat licences). But
  it's **clinical-safety regulated** (MBS/PBS/My Health Record), high switching cost, slow to build, and
  not finance/document-adjacent to Leasium. Great business, wrong "quick-develop" profile — and AU
  challengers (Halaxy, Praktika, Cliniko) are already chipping at it.

## Worth a quick teardown next (unverified — name only)
- **Self-storage management** (US has modern cloud; AU legacy; property-adjacent, simple).
- **Hospitality POS — "Toast for Australia"** (Toast hasn't entered AU; AU POS is fragmented/legacy) —
  but hardware + capital-heavy, off-profile.
- **Childcare/OOSH** (CCS-heavy; QikKids legacy vs Xplor/OWNA modern — likely contested).
- **Veterinary** (ezyVet already modern — likely closed).

## Recommendation
Don't scatter across unrelated verticals — the generic "copy a US SaaS" edge is weak in AU because
locals copy fast. **Concentrate the arbitrage where Leasium's moat already exists:**
1. **Strata / body corporate** — effectively a second skin on the Leasium platform; legacy, quote-based
   incumbents; same AU-regulatory moat. The highest-leverage "second product."
2. **Conveyancing / small-firm trust** — a document-AI + trust-accounting pivot into a weak, consolidated,
   expensive incumbent market.
Treat health-practice management as a *separate, slower, regulated business* — interesting, but not the
quick build Leasium's playbook is shaped for. Park trades (ServiceM8 won) and gym (poor fit).

## Sources
- Strata: MRI Strata Master (https://www.mrisoftware.com/au/products/strata-master/), PMVA strata guide (https://www.pmva.com.au/best-strata-management-software/), StrataMax (smartstrata.com listing)
- GP/medical: Best Practice / Medical Director / Halaxy comparison (https://blog.halaxy.com/best-practice-vs-medical-director-vs-halaxy-why-australian-gps-are-choosing-a-new-foundation-for-their-practice/), MedicalDirector (https://www.medicaldirector.com/solutions/practice-management-software)
- Dental: Centaur/Dental4Windows (https://centaursoftware.com.au/), Praktika (https://praktika.com.au/)
- NDIS: ShiftCare (https://shiftcare.com/), NDISCompliant comparison (https://ndiscompliant.com.au/blog/best-ndis-software-providers)
- Trades: TradieFlow comparison (https://tradieflow.net.au/blog/best-job-management-software-tradies-australia)
- Legal: LexUnits Actionstep-vs-LEAP-vs-Clio-vs-Smokeball (https://lexunits.com/blog/actionstep-vs-leap-vs-clio-vs-smokeball), Law Support AU (https://www.lawsupport.com.au/resources/legal-practice-management-software-australia.html)
- Fitness: Vibefam AU gym software (https://vibefam.com/best-gym-management-software-in-australia-2025/), Hapana (https://www.hapana.com/)
