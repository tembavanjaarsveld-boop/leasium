"""Generate the repo handover from the Relby Obsidian brain.

The vault is canonical for product direction and active priorities. The repo
remains canonical for exact code, tests, migrations, deployment setup, and git
state.
"""

from __future__ import annotations

import argparse
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

DEFAULT_RELBY_ROOT = Path("/Users/tembavanjaarsveld/Documents/Temba OS/10_Projects/Relby")
DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = DEFAULT_REPO_ROOT / "docs/next-chat-handover.md"
MAX_HANDOVER_LINES = 300


class MirrorError(RuntimeError):
    """Raised when a strict mirror input is missing or invalid."""


@dataclass(frozen=True)
class Note:
    relative_path: str
    path: Path
    frontmatter: dict[str, str]
    body: str


def _parse_frontmatter(text: str, *, path: Path) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise MirrorError(f"{path} must start with YAML frontmatter")

    try:
        closing_index = lines[1:].index("---") + 1
    except ValueError as exc:
        raise MirrorError(f"{path} has no closing frontmatter marker") from exc

    frontmatter: dict[str, str] = {}
    for raw_line in lines[1:closing_index]:
        line = raw_line.strip()
        if not line or line.startswith("-") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        frontmatter[key.strip()] = value.strip().strip('"').strip("'")

    body = "\n".join(lines[closing_index + 1 :]).strip()
    return frontmatter, body


def load_note(relby_root: Path, relative_path: str) -> Note:
    path = relby_root / relative_path
    if not path.exists():
        raise MirrorError(f"Required Obsidian note is missing: {path}")

    frontmatter, body = _parse_frontmatter(path.read_text(encoding="utf-8"), path=path)
    if frontmatter.get("canonical") != "true":
        raise MirrorError(f"Required Obsidian note is not canonical: {path}")
    if not frontmatter.get("updated"):
        raise MirrorError(f"Required Obsidian note has no updated date: {path}")

    return Note(
        relative_path=relative_path,
        path=path,
        frontmatter=frontmatter,
        body=body,
    )


def extract_section(markdown: str, heading: str) -> str:
    target = f"## {heading}"
    lines = markdown.splitlines()
    start_index: int | None = None
    for index, line in enumerate(lines):
        if line.strip() == target:
            start_index = index + 1
            break

    if start_index is None:
        raise MirrorError(f"Missing required section: {target}")

    section_lines: list[str] = []
    for line in lines[start_index:]:
        if line.startswith("## "):
            break
        section_lines.append(line)

    section = "\n".join(section_lines).strip()
    if not section:
        raise MirrorError(f"Required section is empty: {target}")
    return section


def _append_block(lines: list[str], heading: str, body: str) -> None:
    lines.extend(["", heading, "", body.strip()])


def _format_git_status(git_status: list[str]) -> str:
    if not git_status:
        return "- No local changes reported by `git status --short`."
    return "\n".join(f"- `{line}`" for line in git_status)


def _format_git_log(git_log: list[str]) -> str:
    if not git_log:
        return "- No recent commits returned."

    formatted: list[str] = []
    for line in git_log:
        if " " in line:
            short_hash, subject = line.split(" ", 1)
            formatted.append(f"- `{short_hash}` {subject}")
        else:
            formatted.append(f"- `{line}`")
    return "\n".join(formatted)


def filter_git_status(git_status: list[str], ignored_paths: set[str]) -> list[str]:
    """Remove generated files from porcelain status before mirroring it."""
    filtered: list[str] = []
    for line in git_status:
        status_path = line[3:].strip() if len(line) > 3 else line.strip()
        if status_path in ignored_paths:
            continue
        filtered.append(line)
    return filtered


def build_handover(
    *,
    relby_root: Path,
    repo_root: Path,
    today: date,
    git_status: list[str],
    git_log: list[str],
) -> str:
    current_state = load_note(relby_root, "Brain/CURRENT_BRAIN_STATE.md")
    active_work = load_note(relby_root, "Brain/ACTIVE_WORK.md")
    operating_rules = load_note(relby_root, "Brain/PRODUCT_OPERATING_RULES.md")
    next_actions = load_note(relby_root, "NEXT_ACTIONS.md")

    lines = [
        "# Relby Next Chat Handover",
        "",
        f"Last updated: {today.isoformat()}",
        "",
        f"Generated from Obsidian: `{relby_root}`",
        "Generator: `scripts/generate_obsidian_handover.py`",
        "",
        "The vault is canonical for product direction, active priorities, durable",
        "decisions, and AI handover context. This repo remains canonical for exact",
        "code, tests, migrations, deployment setup, recent commits, and",
        "implementation proof. If direction conflicts, surface the mismatch before",
        "editing; if code behavior conflicts, inspect the repo and tests.",
        "",
        "Refresh checklist: [docs/obsidian-mirror-checklist.md](obsidian-mirror-checklist.md).",
        "",
        "## Read This First",
        "",
        "- Work lands directly on `main`; no PRs, no co-authors, no generated-with lines.",
        "- Start with the Obsidian notes listed in the mirror checklist, then inspect",
        "  `git status --short` and `git log --oneline -12`.",
        "- Provider guardrail is non-negotiable: no Xero write, SendGrid email, Twilio",
        "  SMS, tenant email, payment action, or reconciliation without explicit",
        "  operator approval.",
        "- UX-facing work uses the in-loop UX gate in",
        "  [docs/design-governance.md](design-governance.md).",
        f"- Repo path: `{repo_root}`.",
    ]

    _append_block(
        lines,
        "## Product Promise",
        extract_section(current_state.body, "Product Promise"),
    )
    _append_block(
        lines,
        "## Current Shipped State",
        extract_section(current_state.body, "Current Shipped State"),
    )
    _append_block(lines, "## Active Work Now", extract_section(active_work.body, "Now"))
    _append_block(
        lines,
        "## Current Active Tracks",
        extract_section(active_work.body, "Current Active Tracks"),
    )
    _append_block(
        lines,
        "## Current Cautions",
        extract_section(current_state.body, "Current Cautions"),
    )

    lines.extend(["", "## Operating Guardrails"])
    _append_block(
        lines,
        "### Provider Mutation Guardrail",
        extract_section(operating_rules.body, "Provider Mutation Guardrail"),
    )
    _append_block(lines, "### Design Gate", extract_section(operating_rules.body, "Design Gate"))

    lines.extend(["", "## Local Git State", "", _format_git_status(git_status)])
    lines.extend(["", "## Recent Feature Commits", "", _format_git_log(git_log)])
    _append_block(lines, "## Next Actions Now", extract_section(next_actions.body, "Now"))
    _append_block(lines, "## Next Actions Later", extract_section(next_actions.body, "Next"))

    lines.extend(
        [
            "",
            "## Verification Cheatsheet",
            "",
            "Backend:",
            "",
            "```bash",
            ".venv/bin/python -m ruff check apps stewart tests scripts",
            ".venv/bin/python -m pytest",
            "```",
            "",
            "Frontend:",
            "",
            "```bash",
            "cd apps/web",
            "./node_modules/.bin/eslint src tests/smoke",
            "./node_modules/.bin/tsc --noEmit",
            "NODE_ENV=development NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs "
            "./node_modules/.bin/playwright test tests/smoke/intake-conversation.spec.ts "
            "--reporter=line",
            "```",
            "",
            "Use focused checks for small slices, then broaden when touching shared flows",
            "or provider guardrails.",
            "",
            "## Key Docs",
            "",
            "- [docs/product-roadmap.md](product-roadmap.md) - shipped features and next",
            "  build order.",
            "- [docs/design-governance.md](design-governance.md) - UX gate, pass log, and",
            "  UX debt register.",
            "- [docs/leasium-codex-design-source-of-truth.md]"
            "(leasium-codex-design-source-of-truth.md) - visual/product source.",
            "- [docs/obsidian-mirror-checklist.md](obsidian-mirror-checklist.md) - mirror",
            "  refresh protocol.",
            "",
            "## Handover Hygiene",
            "",
            "- Target length: under 300 lines.",
            "- Keep newest, actionable context here; keep long history in the vault or",
            "  `docs/handover/archive/`.",
            "- Regenerate this file instead of hand-copying Obsidian state.",
        ]
    )

    handover = "\n".join(lines).rstrip() + "\n"
    if len(handover.splitlines()) >= MAX_HANDOVER_LINES:
        raise MirrorError(
            f"Generated handover has {len(handover.splitlines())} lines; "
            f"limit is {MAX_HANDOVER_LINES - 1}"
        )
    return handover


def run_git(repo_root: Path, args: list[str]) -> list[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.splitlines()


def write_handover(output_path: Path, content: str, *, check: bool) -> bool:
    current = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    if current == content:
        return False
    if check:
        raise MirrorError(f"{output_path} is not up to date; run the generator without --check")
    output_path.write_text(content, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate docs/next-chat-handover.md from the Relby Obsidian brain."
    )
    parser.add_argument("--vault", type=Path, default=DEFAULT_RELBY_ROOT)
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="fail if output is stale")
    args = parser.parse_args(argv)

    content = build_handover(
        relby_root=args.vault,
        repo_root=args.repo,
        today=date.today(),
        git_status=filter_git_status(
            run_git(args.repo, ["status", "--short"]),
            {args.output.relative_to(args.repo).as_posix()},
        ),
        git_log=run_git(args.repo, ["log", "--oneline", "-12"]),
    )
    changed = write_handover(args.output, content, check=args.check)
    if changed:
        print(f"Updated {args.output}")
    else:
        print(f"{args.output} is already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
