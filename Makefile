SHELL := /bin/bash

.PHONY: install migrate seed dev test lint format

install:
	uv sync --all-groups
	cd apps/web && pnpm install

migrate:
	uv run alembic upgrade head

seed:
	uv run python -m scripts.seed

dev:
	(uv run uvicorn apps.api.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${API_PORT:-8000}) & \
	(cd apps/web && pnpm dev)

test:
	uv run pytest

lint:
	uv run ruff check .
	uv run mypy apps stewart scripts tests
	cd apps/web && pnpm lint

format:
	uv run ruff format .
	uv run ruff check --fix .
	cd apps/web && pnpm format
