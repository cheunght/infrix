#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  ./deploy-to-remote.sh <ssh-target> [remote-source-dir]

示例：
  ./deploy-to-remote.sh root@rocky-host
  ./deploy-to-remote.sh deploy@server-host /opt/itam-src

说明：
  ssh-target       SSH 目标，例如 user@hostname 或 ~/.ssh/config 中的主机别名
  remote-source-dir 远程源码目录，默认使用 ITAM_REMOTE_SRC 或 /opt/itam-src
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

HOST="$1"
if [[ -z "$HOST" || "$HOST" == -* ]]; then
  echo "错误：ssh-target 不能为空或以短横线开头。" >&2
  exit 2
fi

if [[ $# -eq 2 ]]; then
  REMOTE_SRC="$2"
else
  REMOTE_SRC="${ITAM_REMOTE_SRC:-/opt/itam-src}"
fi
if [[ -z "$REMOTE_SRC" || "$REMOTE_SRC" == -* ]]; then
  echo "错误：remote-source-dir 不能为空或以短横线开头。" >&2
  exit 2
fi

command -v rsync >/dev/null 2>&1 || { echo "错误：未找到 rsync。" >&2; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "错误：未找到 ssh。" >&2; exit 1; }

# Quote values that are interpolated into the remote shell command.  The
# rsync destination remains one local argument, so paths containing spaces
# are also passed without being split by the local shell.
shell_quote() {
  local value="$1"
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

REMOTE_SRC_QUOTED="$(shell_quote "$REMOTE_SRC")"

# macOS 自带 rsync 2.6.9 不支持 --info=progress2；--progress 同时兼容
# macOS 和 Rocky 9，仍会显示文件传输进度。
rsync -az --delete --progress \
  --exclude='.git/' \
  --exclude='.venv/' \
  --exclude='backend/.venv/' \
  --exclude='backend/db.sqlite3' \
  --exclude='backend/staticfiles/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='*.pyc' \
  --exclude='__pycache__/' \
  --exclude='.pytest_cache/' \
  ./ "$HOST:$REMOTE_SRC/"

ssh "$HOST" \
  "cd -- $REMOTE_SRC_QUOTED && SOURCE_DIR=$REMOTE_SRC_QUOTED APP_DIR=/opt/itam bash deploy/install.sh"
