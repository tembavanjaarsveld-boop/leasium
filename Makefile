SHELL := /bin/bash

.PHONY: install migrate seed dev test lint typecheck format

install:
	.venv/bin/python -m pip install -e '.[dev]'
	cd apps/web && npm install

migrate:
	.venv/bin/alembic upgrade head

seed:
	.venv/bin/python -m scripts.seed

dev:
	(.venv/bin/uvicorn apps.api.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${API_PORT:-8000}) & \
	(cd apps/web && NEXT_PUBLIC_API_BASE_URL=$${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8000/api/v1} NEXT_TEST_WASM_DIR=$$PWD/node_modules/@next/swc-wasm-nodejs ./node_modules/.bin/next dev)

test:
	.venv/bin/python -m pytest

lint:
	.venv/bin/python -m ruff check apps stewart tests scripts
	cd apps/web && ./node_modules/.bin/eslint . && ./node_modules/.bin/tsc --noEmit

typecheck:
	.venv/bin/python -m mypy apps stewart scripts tests
	cd apps/web && ./node_modules/.bin/tsc --noEmit

format:
	.venv/bin/python -m ruff format apps stewart tests scripts
	.venv/bin/python -m ruff check apps stewart tests scripts --fix
	cd apps/web && ./node_modules/.bin/prettier --write .
