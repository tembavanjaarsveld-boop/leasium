# Owner Statement Split Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allocate owner statement property totals by `PropertyOwner.split_pct` so shared ownership no longer duplicates full property invoices across every linked owner.

**Architecture:** Keep the existing Owner/PropertyOwner grouping contract, but carry each owner-property link's split percentage into statement aggregation. For every source invoice, calculate the owner share of total, paid, and outstanding cents; statement summaries, property lines, invoice evidence, PDFs, and statement pack CSVs should all read from the allocated evidence values. Unlinked properties remain in the `Unattributed` bucket at 100%.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, pytest, existing owner statement PDF/CSV helpers.

---

## Guardrails

- Read path only: do not touch statement send/dispatch behavior beyond proving it still reads allocated statement totals.
- No Xero writes, SendGrid email, Twilio SMS, tenant email, payment reconciliation, provider refresh, or provider-history mutation.
- Do not change the Owner/PropertyOwner model or require a data migration in this slice.
- Treat legacy `Property.owner_*` fields as a backfill source only; split allocation must use `PropertyOwner.split_pct`.

## Files

- Modify: `tests/integration/test_owners_api.py` — add red/green coverage for shared-property allocation.
- Modify: `apps/api/routers/owners.py` — select `PropertyOwner.split_pct` and aggregate allocated invoice evidence.
- Modify: `docs/product-roadmap.md` — record the owner statement split allocation under the owner-reporting P0/P1 status.
- Modify: `docs/next-chat-handover.md` — record the shipped slice, verification, and remaining production Clerk test blocker.

## Task 1: Backend Split Allocation

- [x] **Step 1: Write the failing test**

Add `test_owner_statements_allocates_shared_property_totals_by_split_pct` to `tests/integration/test_owners_api.py`. It should seed:

```python
owner_a = Owner(entity_id=entity.id, legal_name="Alpha Split Pty Ltd")
owner_b = Owner(entity_id=entity.id, legal_name="Beta Split Pty Ltd")
prop = Property(
    entity_id=entity.id,
    name="Shared Split Property",
    street_address="10 Split Street",
    property_type=PropertyType.commercial_retail,
)
session.add_all([owner_a, owner_b, prop])
session.flush()
session.add_all(
    [
        PropertyOwner(property_id=prop.id, owner_id=owner_a.id, split_pct=60),
        PropertyOwner(property_id=prop.id, owner_id=owner_b.id, split_pct=40),
    ]
)
session.add(
    InvoiceDraft(
        entity_id=entity.id,
        billing_draft_id=bd.id,
        property_id=prop.id,
        document_id=doc.id,
        status=InvoiceDraftStatus.approved,
        title="Shared split invoice",
        currency="AUD",
        issue_date=date(2026, 4, 15),
        subtotal_cents=100_000,
        gst_cents=0,
        total_cents=100_000,
        invoice_metadata={"paid_cents": 25_000},
    )
)
```

Then call `GET /api/v1/owners/statements?entity_id=...&month=2026-04` and assert:

```python
owners = {owner["owner_identity"]: owner for owner in response.json()["owners"]}
assert owners["Alpha Split Pty Ltd"]["invoiced_cents"] == 60_000
assert owners["Alpha Split Pty Ltd"]["paid_cents"] == 15_000
assert owners["Alpha Split Pty Ltd"]["outstanding_cents"] == 45_000
assert owners["Beta Split Pty Ltd"]["invoiced_cents"] == 40_000
assert owners["Beta Split Pty Ltd"]["paid_cents"] == 10_000
assert owners["Beta Split Pty Ltd"]["outstanding_cents"] == 30_000

alpha_invoice = owners["Alpha Split Pty Ltd"]["properties"][0]["invoices"][0]
assert alpha_invoice["total_cents"] == 60_000
assert alpha_invoice["paid_cents"] == 15_000
assert alpha_invoice["outstanding_cents"] == 45_000
```

Also add `test_owner_statements_allocates_split_rounding_residue_once` with a
one-cent 50/50 split invoice. It should fail until the allocator balances
rounding residue across the property owner links instead of rounding each owner
share independently.

Review follow-up tests added during implementation:
`test_owner_statements_preserves_allocated_invoice_balance` proves allocated
evidence remains internally balanced when the source invoice is balanced, and
`test_owner_statement_split_allocator_caps_paid_with_fixed_residue_order`
proves tiny split percentages cannot receive more paid cents than their
allocated total. `test_owner_statements_caps_allocated_paid_to_allocated_total`
keeps that cap covered through the endpoint.
`test_owner_statement_split_allocator_normalizes_over_allocated_links` proves
invalid over-100 linked splits cannot duplicate the full source invoice. Finally,
`test_owner_portal_statement_matches_duplicate_shared_owner_by_owner_id` proves
owner portal previews use the stable statement owner id when duplicate-label
co-owners share the same property.

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owners_api.py::test_owner_statements_allocates_shared_property_totals_by_split_pct -q
```

Expected: fail because both linked owners currently receive the full `100_000` invoice, `25_000` paid, and `75_000` outstanding.

- [x] **Step 3: Implement minimal allocation**

In `apps/api/routers/owners.py`, change the owner link query to include `PropertyOwner.split_pct`, store statement bucket property entries as `{"property": prop, "split_pct": split_pct}`, and use a helper like:

```python
def _allocated_cents(cents: int, split_pct: float) -> int:
    return int(
        (Decimal(cents) * Decimal(str(split_pct)) / Decimal("100")).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )
```

When building each owner property line, create allocated invoice evidence with `total_cents`, `paid_cents`, and `outstanding_cents` replaced by the owner share before summing statement totals.

- [x] **Step 4: Run focused backend tests**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owners_api.py::test_owner_statements_allocates_shared_property_totals_by_split_pct tests/integration/test_owner_statement_parity.py -q
```

Expected: the new allocation test and existing grouping parity test pass.

## Task 2: Regression Sweep and Docs

- [x] **Step 1: Run owner statement regression tests**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_owners_api.py tests/integration/test_owner_portal_api.py tests/integration/test_owner_portal_auth_api.py tests/integration/test_owner_statement_parity.py -q
```

Expected: all pass. This covers statements, portal projections that reuse `_build_owner_statements`, account auth, and parity. Actual run after review fixes: **35 passed**.

Frontend smoke after the additive `owner_id` statement field:
`cd apps/web && ./node_modules/.bin/playwright test tests/smoke/statements.spec.ts --workers=1`
passed **3 passed**.

- [x] **Step 2: Run backend lint**

Run:

```bash
.venv/bin/python -m ruff check apps/api/routers/owners.py tests/integration/test_owners_api.py
```

Expected: all checks pass.

- [x] **Step 3: Update docs**

Update `docs/product-roadmap.md` and `docs/next-chat-handover.md` to state that owner statement shared-property totals are allocated by `PropertyOwner.split_pct`, while provider send/dispatch remains approval-only and unchanged.

- [x] **Step 4: Commit and deploy**

Commit directly on `main`, push, then verify Render health and live OpenAPI still expose `/api/v1/owners/statements`.

Actual: code commit `4305533` (`Allocate owner statements by ownership split`) was pushed to `main`. Vercel production deploy `dpl_5G4GWVCp1Q8gXyQpkpujX6JwMcov` reached **READY**; `https://leasium.ai/statements` returned HTTP 200; Render health reported `43055333993c3575581bc66a1411d4b12188256f` with `source=render`; live OpenAPI still exposes `/api/v1/owners/statements`.
