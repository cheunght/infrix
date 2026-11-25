#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${INFRIX_ENV_FILE:-${INFIX_ENV_FILE:-/etc/infrix/infrix.env}}"
if [[ ! -x .venv/bin/python ]]; then
  echo "未找到虚拟环境，请先执行 ./setup.sh" >&2
  exit 1
fi
if [[ -f "$ENV_FILE" ]]; then
  exec .venv/bin/python -I infrix_env.py "$ENV_FILE" .venv/bin/python manage.py "$@"
elif [[ "${INFRIX_ENV_FILE:-${INFIX_ENV_FILE:-}}" || "${DJANGO_ENV:-development}" == "production" ]]; then
  echo "Production environment file not found: $ENV_FILE" >&2
  exit 1
fi
case "${DJANGO_ENV:-development}" in
  production|development) ;;
  *)
    echo "DJANGO_ENV must be either production or development." >&2
    exit 1
    ;;
esac
exec .venv/bin/python manage.py "$@"
