"""Obsidian-to-repo handover mirror tests."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest


def _write_note(root: Path, relative_path: str, *, body: str, canonical: bool = True) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "---",
                f"canonical: {str(canonical).lower()}",
                "updated: 2026-06-27",
                "---",
                "",
                body.strip(),
                "",
            ]
        ),
        encoding="utf-8",
    )


def _generator():
    try:
        from scripts import generate_obsidian_handover
    except ImportError as exc:  # pragma: no cover - red state before implementation exists.
        pytest.fail(f"handover generator module is missing: {exc}")
    return generate_obsidian_handover


def _seed_relby_vault(root: Path) -> None:
    _write_note(
        root,
        "Brain/CURRENT_BRAIN_STATE.md",
        body="""
# Current Brain State

## Product Promise

Documents become reviewed work.

## Current Shipped State

- Smart Intake matcher UI is shipped.
- Property duplicate guard is shipped.

## Current Cautions

- Do not run provider writes without approval.
""",
    )
    _write_note(
        root,
        "Brain/ACTIVE_WORK.md",
        body="""
# Active Work

## Now

1. Verify the latest Relby AI deploy.
2. Dry-run stored-row rebrand data.

## Current Active Tracks

| Track | State | Notes |
| --- | --- | --- |
| Obsidian repo mirror | generated next | Replace manual copying. |
""",
    )
    _write_note(
        root,
        "Brain/PRODUCT_OPERATING_RULES.md",
        body="""
# Product Operating Rules

## Provider Mutation Guardrail

Never run a Xero write, SendGrid email, Twilio SMS, tenant email, payment
action, or reconciliation without explicit operator approval.

## Design Gate

Design-facing changes use the in-loop UX gate.
""",
    )
    _write_note(
        root,
        "NEXT_ACTIONS.md",
        body="""
# Relby Next Actions

## Now

- Verify the deploy.

## Next

- Trim repo handover after generation exists.
""",
    )


def test_build_handover_uses_vault_notes_and_local_git_state(tmp_path: Path) -> None:
    generator = _generator()
    relby_root = tmp_path / "Relby"
    repo_root = tmp_path / "Stewart"
    repo_root.mkdir()
    _seed_relby_vault(relby_root)

    handover = generator.build_handover(
        relby_root=relby_root,
        repo_root=repo_root,
        today=date(2026, 6, 27),
        git_status=[" M CLAUDE.md", "?? docs/obsidian-mirror-checklist.md"],
        git_log=["abc1234 Ship useful thing", "def5678 Add prior context"],
    )

    assert "Last updated: 2026-06-27" in handover
    assert f"Generated from Obsidian: `{relby_root}`" in handover
    assert "- Smart Intake matcher UI is shipped." in handover
    assert "1. Verify the latest Relby AI deploy." in handover
    assert "| Obsidian repo mirror | generated next | Replace manual copying. |" in handover
    assert "- ` M CLAUDE.md`" in handover
    assert "- `?? docs/obsidian-mirror-checklist.md`" in handover
    assert "- `abc1234` Ship useful thing" in handover
    assert len(handover.splitlines()) < 300


def test_build_handover_marks_clean_worktree(tmp_path: Path) -> None:
    generator = _generator()
    relby_root = tmp_path / "Relby"
    repo_root = tmp_path / "Stewart"
    repo_root.mkdir()
    _seed_relby_vault(relby_root)

    handover = generator.build_handover(
        relby_root=relby_root,
        repo_root=repo_root,
        today=date(2026, 6, 27),
        git_status=[],
        git_log=[],
    )

    assert "- No local changes reported by `git status --short`." in handover
    assert "- No recent commits returned." in handover


def test_filter_git_status_omits_generated_output() -> None:
    generator = _generator()

    filtered = generator.filter_git_status(
        [
            " M CLAUDE.md",
            " M docs/next-chat-handover.md",
            "?? docs/codex-brief.md",
        ],
        {"docs/next-chat-handover.md"},
    )

    assert filtered == [" M CLAUDE.md", "?? docs/codex-brief.md"]


def test_load_note_rejects_non_canonical_vault_inputs(tmp_path: Path) -> None:
    generator = _generator()
    relby_root = tmp_path / "Relby"
    _write_note(
        relby_root,
        "Brain/CURRENT_BRAIN_STATE.md",
        body="# Current Brain State",
        canonical=False,
    )

    with pytest.raises(generator.MirrorError, match="canonical"):
        generator.load_note(relby_root, "Brain/CURRENT_BRAIN_STATE.md")
