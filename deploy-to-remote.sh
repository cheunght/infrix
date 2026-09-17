#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  ./deploy-to-remote.sh [--config /服务器上的/infrix.env] [--non-interactive] <ssh-target> [remote-source-dir]

示例：
  ./deploy-to-remote.sh root@rocky-host
  ./deploy-to-remote.sh deploy@server-host /tmp/infrix-src

说明：
  ssh-target       SSH 目标，例如 user@hostname 或 ~/.ssh/config 中的主机别名
  remote-source-dir 远程源码目录，必须是 SSH 用户可写目录；默认使用
                     INFRIX_REMOTE_SRC 或 /tmp/infrix-src
EOF
}

REMOTE_CONFIG=""
NON_INTERACTIVE=0
while [[ "${1:-}" == -* ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --config)
      [[ $# -ge 2 && "$2" = /* ]] || { echo '--config 需要服务器上的绝对路径' >&2; exit 2; }
      REMOTE_CONFIG="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    *) usage >&2; exit 2 ;;
  esac
done

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
  # rsync connects as the SSH user, while deploy/install.sh escalates only
  # after the source tree has been uploaded.  Keep the staging directory in a
  # user-writable location so a normal sudo-capable deployment user does not
  # need write permission on /opt.
  REMOTE_SRC="${INFRIX_REMOTE_SRC:-/tmp/infrix-src}"
fi
if [[ ! "$REMOTE_SRC" =~ ^/[A-Za-z0-9._/-]+$ || "$REMOTE_SRC" == / || "$REMOTE_SRC" == /tmp || "$REMOTE_SRC" == /opt || "$REMOTE_SRC" == /home || "$REMOTE_SRC" == /root || "$REMOTE_SRC" == *'/../'* || "$REMOTE_SRC" == */.. ]]; then
  echo "错误：remote-source-dir 必须是专用源码目录的绝对路径，不支持空格。" >&2
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
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DIST_FILTER=--exclude=frontend/dist/
if [[ -f "$PROJECT_ROOT/frontend-release.json" ]]; then
  python3 "$PROJECT_ROOT/scripts/release-package.py" --verify-frontend "$PROJECT_ROOT"
  DIST_FILTER=--exclude=frontend/node_modules/
fi
INSTALL_ARGS=""
if [[ -n "$REMOTE_CONFIG" ]]; then
  INSTALL_ARGS=" --config $(shell_quote "$REMOTE_CONFIG")"
fi
SSH_TTY=(-T)
SUDO_COMMAND='sudo -n'
if [[ "$NON_INTERACTIVE" == 0 && -t 0 ]]; then
  SSH_TTY=(-t)
  SUDO_COMMAND=sudo
fi
# Validate SSH and privilege access before uploading a source tree.
ssh "${SSH_TTY[@]}" "$HOST" "$SUDO_COMMAND true"
ssh "${SSH_TTY[@]}" "$HOST" "command -v rsync >/dev/null || $SUDO_COMMAND dnf install -y rsync"

# macOS 自带 rsync 2.6.9 不支持 --info=progress2；--progress 同时兼容
# macOS 和 Rocky 9，仍会显示文件传输进度。
rsync -az --delete --progress \
  --exclude='.git/' \
  --exclude='.venv/' \
  --exclude='backend/.venv/' \
  --exclude='backend/db.sqlite3' \
  --exclude='backend/staticfiles/' \
  --exclude='frontend/node_modules/' \
  "$DIST_FILTER" \
  --exclude='*.pyc' \
  --exclude='__pycache__/' \
  --exclude='.pytest_cache/' \
  --exclude='.env' \
  --exclude='*.env' \
  --exclude='*.key' \
  --exclude='*.pem' \
  "$PROJECT_ROOT/" "$HOST:$REMOTE_SRC/"

ssh "${SSH_TTY[@]}" "$HOST" \
  "cd -- $REMOTE_SRC_QUOTED && $SUDO_COMMAND env SOURCE_DIR=$REMOTE_SRC_QUOTED APP_DIR=/opt/infrix bash deploy/install.sh$INSTALL_ARGS"
