PYTHON ?= python3
VENV := .venv
VENV_PY := $(VENV)/bin/python
VENV_PIP := $(VENV)/bin/pip

.PHONY: install test lint fmt package frontend-install frontend-build frontend-dev tf-fmt tf-validate clean

install:
	$(PYTHON) -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip
	$(VENV_PIP) install -r requirements-dev.txt

test:
	PYTHONPATH=src/lambdas/shared $(VENV_PY) -m pytest

lint:
	$(VENV_PY) -m ruff check src scripts

fmt:
	$(VENV_PY) -m ruff format src scripts
	$(VENV_PY) -m ruff check --fix src scripts

package:
	$(PYTHON) scripts/package_lambdas.py

frontend-install:
	npm --prefix frontend install

frontend-build:
	npm --prefix frontend run build

frontend-dev:
	npm --prefix frontend run dev

tf-fmt:
	terraform -chdir=infra fmt -recursive

tf-validate:
	terraform -chdir=infra init -backend=false
	terraform -chdir=infra validate

clean:
	rm -rf build frontend/dist .pytest_cache .ruff_cache
