#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "需要 Python 3.10+；当前为 $($PYTHON_BIN --version)，可设置 PYTHON_BIN=python3.11" >&2
  exit 1
fi
if [[ -x .venv/bin/python ]] && ! .venv/bin/python -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  rm -rf .venv
fi
"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -c 'import django; print("Django", django.get_version())'
.venv/bin/python manage.py migrate
echo "Backend ready: .venv/bin/python manage.py runserver"
