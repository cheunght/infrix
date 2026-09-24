#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -x .venv/bin/python ]]; then
  echo "未找到 backend 虚拟环境，请先执行 ./setup.sh" >&2
  exit 1
fi

test_status=0
test_output="$(.venv/bin/python manage.py test --verbosity 1 2>&1)" || test_status=$?
printf '%s\n' "$test_output"

if (( test_status != 0 )); then
  exit "$test_status"
fi

if grep -Eq '^Ran 0 tests([[:space:]]|$)' <<<"$test_output"; then
  echo "Backend test discovery found zero tests; refusing to treat it as success." >&2
  exit 1
fi
