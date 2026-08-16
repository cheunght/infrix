#!/usr/bin/env bash
set -e

HOST="${ITAM_SSH_HOST:-root@192.168.9.128}"
REMOTE_SRC="${ITAM_REMOTE_SRC:-/opt/itam-src}"

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
  "cd $REMOTE_SRC && SOURCE_DIR=$REMOTE_SRC APP_DIR=/opt/itam bash deploy/install.sh"
