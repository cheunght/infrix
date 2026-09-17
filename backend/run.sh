#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${INFIX_ENV_FILE:-/etc/infrix/infrix.env}"
if [[ ! -x .venv/bin/python ]]; then
  echo "未找到虚拟环境，请先执行 ./setup.sh" >&2
  exit 1
fi
if [[ -f "$ENV_FILE" ]]; then
  if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?DJANGO_ENV=' "$ENV_FILE"; then
    echo "Environment file must define DJANGO_ENV: $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
elif [[ "${DJANGO_ENV:-development}" == "production" ]]; then
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
