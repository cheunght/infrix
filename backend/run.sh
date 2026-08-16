#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "未找到虚拟环境，请先执行 ./setup.sh" >&2
  exit 1
fi
if [[ -f /etc/itam/itam.env ]]; then
  set -a
  . /etc/itam/itam.env
  set +a
fi
exec .venv/bin/python manage.py "$@"
