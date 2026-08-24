#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  echo "错误：$*" >&2
  exit 1
}

on_error() {
  local line="$1"
  echo "安装失败（第 ${line} 行），请查看上面的错误信息。" >&2
  if [[ -n "${BACKUP_FILE:-}" && -s "${BACKUP_FILE:-}" ]]; then
    echo "迁移前备份仍保留：$BACKUP_FILE" >&2
    echo "恢复示例：MYSQL_PWD='<数据库密码>' mariadb -h '${DB_HOST:-127.0.0.1}' -P '${DB_PORT:-3306}' -u '${DB_USER:-itam}' '${DB_NAME:-itam}' < '$BACKUP_FILE'" >&2
  fi
  systemctl status itam --no-pager >&2 2>/dev/null || true
  journalctl -u itam -n 60 --no-pager >&2 2>/dev/null || true
}
trap 'on_error "$LINENO"' ERR

if [[ "$(id -u)" -ne 0 ]]; then
  fail "请使用 root 执行：sudo -E ./deploy/install.sh"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR="${SOURCE_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd -P)}"
ENV_FILE="${ENV_FILE:-/etc/itam/itam.env}"
APP_DIR="${APP_DIR:-/opt/itam}"
APP_USER="${APP_USER:-itam}"
APP_GROUP="${APP_GROUP:-itam}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-/etc/nginx/conf.d/itam.conf}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/itam}"
SKIP_MARIADB="${SKIP_MARIADB:-0}"
PYTHON_BIN="${PYTHON_BIN:-}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-3}"
BACKUP_FILE=""

[[ -f /etc/rocky-release ]] || fail "此脚本仅支持 Rocky Linux 9。"
[[ -f "$SOURCE_DIR/backend/manage.py" ]] || fail "SOURCE_DIR 不是项目根目录：$SOURCE_DIR"
[[ -f "$SOURCE_DIR/frontend/package.json" ]] || fail "未找到 frontend/package.json。"
[[ -f "$SOURCE_DIR/frontend/package-lock.json" ]] || fail "未找到 frontend/package-lock.json，无法执行 npm ci。"

# 已有环境文件优先。脚本不会覆盖它，便于重复执行和更新部署。
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DB_ENGINE="${DB_ENGINE:-mysql}"
DB_NAME="${DB_NAME:-itam}"
DB_USER="${DB_USER:-itam}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DJANGO_ENV="${DJANGO_ENV:-production}"
DJANGO_DEBUG="${DJANGO_DEBUG:-0}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-}"
DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-}"
DJANGO_CSRF_TRUSTED_ORIGINS="${DJANGO_CSRF_TRUSTED_ORIGINS:-}"
DJANGO_HTTPS_MODE="${DJANGO_HTTPS_MODE:-proxy}"
DJANGO_SECURE_SSL_REDIRECT="${DJANGO_SECURE_SSL_REDIRECT:-1}"
DJANGO_SESSION_COOKIE_SECURE="${DJANGO_SESSION_COOKIE_SECURE:-1}"
DJANGO_CSRF_COOKIE_SECURE="${DJANGO_CSRF_COOKIE_SECURE:-1}"
DJANGO_SECURE_HSTS_SECONDS="${DJANGO_SECURE_HSTS_SECONDS:-3600}"
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS="${DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS:-0}"
DJANGO_SECURE_HSTS_PRELOAD="${DJANGO_SECURE_HSTS_PRELOAD:-0}"
DJANGO_USE_X_FORWARDED_HOST="${DJANGO_USE_X_FORWARDED_HOST:-0}"
TZ="${TZ:-Asia/Shanghai}"
MARIADB_ROOT_PASSWORD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"

[[ "$APP_DIR" = /* ]] || fail "APP_DIR 必须是绝对路径。"
[[ "$BACKUP_DIR" = /* ]] || fail "BACKUP_DIR 必须是绝对路径。"
[[ "$ENV_FILE" = /* ]] || fail "ENV_FILE 必须是绝对路径。"
[[ "$NGINX_CONF_FILE" = /* ]] || fail "NGINX_CONF_FILE 必须是绝对路径。"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_NAME 只能包含字母、数字和下划线。"
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_USER 只能包含字母、数字和下划线。"
[[ "$DB_PORT" =~ ^[0-9]+$ ]] || fail "DB_PORT 必须是数字。"
[[ "$GUNICORN_WORKERS" =~ ^[1-9][0-9]*$ ]] || fail "GUNICORN_WORKERS 必须是正整数。"
[[ "$SERVER_NAME" != *$'\n'* && "$SERVER_NAME" != *$'\r'* && "$SERVER_NAME" != *' '* ]] || fail "SERVER_NAME 不能包含空格或换行。"
case "$DB_ENGINE" in
  mysql|sqlite) ;;
  *) fail "DB_ENGINE 只能是 mysql 或 sqlite。" ;;
esac
if [[ "$DB_ENGINE" == "sqlite" ]]; then
  SKIP_MARIADB=1
fi

log "安装 Rocky 9 系统依赖"
dnf install -y ca-certificates openssl curl git rsync nginx mariadb-server mariadb \
  gcc gcc-c++ make

# Rocky 9 的 Python 3.11 包在不同小版本中可能来自 AppStream 或模块流，
# 先尝试直接安装，失败后再启用模块；最终仍会检查实际解释器版本。
if [[ -z "$PYTHON_BIN" ]]; then
  if ! dnf install -y python3.11 python3.11-pip python3.11-devel; then
    dnf module enable -y python:3.11 || true
    dnf install -y python3.11 python3.11-pip python3.11-devel || true
  fi
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="python3.11"
  else
    dnf install -y python3 python3-pip python3-devel
    PYTHON_BIN="python3"
  fi
fi

command -v "$PYTHON_BIN" >/dev/null 2>&1 || fail "未找到 Python 解释器：$PYTHON_BIN"
"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
  || fail "Python 版本必须 >= 3.10，当前为 $($PYTHON_BIN --version 2>&1)。"

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
fi
if [[ "$node_major" -lt 18 ]] || ! command -v npm >/dev/null 2>&1; then
  dnf module reset -y nodejs || true
  if ! dnf module enable -y nodejs:20; then
    dnf module enable -y nodejs:18 || true
  fi
  dnf install -y nodejs npm
fi
node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
[[ "$node_major" -ge 18 ]] || fail "Node.js 版本必须 >= 18，当前为 $(node --version)。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm。"

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  log "复制项目到 $APP_DIR"
  getent group "$APP_GROUP" >/dev/null 2>&1 || groupadd --system "$APP_GROUP"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" \
      --create-home --shell /sbin/nologin "$APP_USER"
  fi
  install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR"
  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.venv/' \
    --exclude 'backend/.venv/' \
    --exclude 'backend/db.sqlite3' \
    --exclude 'backend/staticfiles/' \
    --exclude 'frontend/node_modules/' \
    --exclude 'frontend/dist/' \
    --exclude '*.pyc' \
    --exclude '__pycache__/' \
    --exclude '.pytest_cache/' \
    "$SOURCE_DIR/" "$APP_DIR/"
else
  log "SOURCE_DIR 与 APP_DIR 相同，跳过复制。"
fi

getent group "$APP_GROUP" >/dev/null 2>&1 || groupadd --system "$APP_GROUP"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" \
    --create-home --shell /sbin/nologin "$APP_USER"
fi
install -d -m 750 -o root -g "$APP_GROUP" "$(dirname -- "$ENV_FILE")"

if [[ -z "$DB_PASSWORD" && "$DB_ENGINE" == "mysql" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
fi
if [[ "$DB_ENGINE" == "mysql" && ! "$DB_PASSWORD" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]]; then
  fail "DB_PASSWORD 只能包含字母、数字和 . _ @ % + = : , / -，请重新设置。"
fi

if [[ -z "$DJANGO_SECRET_KEY" ]]; then
  DJANGO_SECRET_KEY="$(openssl rand -hex 32)"
fi

case "$DJANGO_ENV" in
  production)
    [[ "$DJANGO_DEBUG" == "0" ]] || fail "生产部署必须设置 DJANGO_DEBUG=0。"
    [[ ${#DJANGO_SECRET_KEY} -ge 50 ]] || fail "DJANGO_SECRET_KEY 缺失或过短，生产部署已阻断。"
    [[ "$DJANGO_SECRET_KEY" != "dev-only-change-me" && "$DJANGO_SECRET_KEY" != "change-me" ]] || \
      fail "DJANGO_SECRET_KEY 仍是开发占位符，生产部署已阻断。"
    [[ -n "${DJANGO_ALLOWED_HOSTS//[[:space:]]/}" ]] || \
      fail "DJANGO_ALLOWED_HOSTS 不能为空，请设置实际域名或 IP。"
    if [[ "$DJANGO_ALLOWED_HOSTS" =~ (^|,)[[:space:]]*\*[[:space:]]*(,|$) ]]; then
      fail "DJANGO_ALLOWED_HOSTS 不允许包含 *。"
    fi
    [[ -n "${DJANGO_CSRF_TRUSTED_ORIGINS//[[:space:]]/}" ]] || \
      fail "DJANGO_CSRF_TRUSTED_ORIGINS 不能为空，请设置 https:// 来源。"
    [[ "$DJANGO_HTTPS_MODE" == "proxy" ]] || \
      fail "当前 Nginx 部署契约要求 DJANGO_HTTPS_MODE=proxy。"
    [[ "$DJANGO_SECURE_SSL_REDIRECT" == "1" ]] || \
      fail "生产部署必须设置 DJANGO_SECURE_SSL_REDIRECT=1。"
    [[ "$DJANGO_SESSION_COOKIE_SECURE" == "1" ]] || \
      fail "生产部署必须设置 DJANGO_SESSION_COOKIE_SECURE=1。"
    [[ "$DJANGO_CSRF_COOKIE_SECURE" == "1" ]] || \
      fail "生产部署必须设置 DJANGO_CSRF_COOKIE_SECURE=1。"
    [[ "$DJANGO_SECURE_HSTS_SECONDS" =~ ^[1-9][0-9]*$ ]] || \
      fail "生产部署必须设置正整数 DJANGO_SECURE_HSTS_SECONDS。"
    [[ "$DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS" =~ ^[01]$ ]] || \
      fail "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS 必须是 0 或 1。"
    [[ "$DJANGO_SECURE_HSTS_PRELOAD" =~ ^[01]$ ]] || \
      fail "DJANGO_SECURE_HSTS_PRELOAD 必须是 0 或 1。"
    [[ "$DJANGO_USE_X_FORWARDED_HOST" == "0" ]] || \
      fail "当前部署不启用 DJANGO_USE_X_FORWARDED_HOST。"
    ;;
  development)
    [[ -n "${DJANGO_ALLOWED_HOSTS//[[:space:]]/}" ]] || \
      fail "开发部署时 DJANGO_ALLOWED_HOSTS 不能为空；可设置为 *。"
    log "开发环境部署：允许 DJANGO_ALLOWED_HOSTS=*，跳过生产安全门禁。"
    ;;
  *)
    fail "DJANGO_ENV 必须是 development 或 production。"
    ;;
esac

append_env_entry() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=$" "$ENV_FILE"; then
    sed -i "/^${key}=$/d" "$ENV_FILE"
  fi
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "创建 $ENV_FILE"
  (
    umask 027
    cat > "$ENV_FILE" <<EOF
DJANGO_ENV=$DJANGO_ENV
DJANGO_DEBUG=$DJANGO_DEBUG
DJANGO_SECRET_KEY=$DJANGO_SECRET_KEY
DJANGO_ALLOWED_HOSTS=$DJANGO_ALLOWED_HOSTS
DJANGO_CSRF_TRUSTED_ORIGINS=$DJANGO_CSRF_TRUSTED_ORIGINS
DJANGO_HTTPS_MODE=$DJANGO_HTTPS_MODE
DJANGO_SECURE_SSL_REDIRECT=$DJANGO_SECURE_SSL_REDIRECT
DJANGO_SESSION_COOKIE_SECURE=$DJANGO_SESSION_COOKIE_SECURE
DJANGO_CSRF_COOKIE_SECURE=$DJANGO_CSRF_COOKIE_SECURE
DJANGO_SECURE_HSTS_SECONDS=$DJANGO_SECURE_HSTS_SECONDS
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=$DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS
DJANGO_SECURE_HSTS_PRELOAD=$DJANGO_SECURE_HSTS_PRELOAD
DJANGO_USE_X_FORWARDED_HOST=$DJANGO_USE_X_FORWARDED_HOST
TZ=$TZ
DB_ENGINE=$DB_ENGINE
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
EOF
  )
else
  # Existing environment files retain their secret and database values; append
  # only the new security contract keys when upgrading an older deployment.
  append_env_entry DJANGO_ENV "$DJANGO_ENV"
  append_env_entry DJANGO_DEBUG "$DJANGO_DEBUG"
  append_env_entry DJANGO_SECRET_KEY "$DJANGO_SECRET_KEY"
  append_env_entry DJANGO_ALLOWED_HOSTS "$DJANGO_ALLOWED_HOSTS"
  append_env_entry DJANGO_CSRF_TRUSTED_ORIGINS "$DJANGO_CSRF_TRUSTED_ORIGINS"
  append_env_entry DJANGO_HTTPS_MODE "$DJANGO_HTTPS_MODE"
  append_env_entry DJANGO_SECURE_SSL_REDIRECT "$DJANGO_SECURE_SSL_REDIRECT"
  append_env_entry DJANGO_SESSION_COOKIE_SECURE "$DJANGO_SESSION_COOKIE_SECURE"
  append_env_entry DJANGO_CSRF_COOKIE_SECURE "$DJANGO_CSRF_COOKIE_SECURE"
  append_env_entry DJANGO_SECURE_HSTS_SECONDS "$DJANGO_SECURE_HSTS_SECONDS"
  append_env_entry DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS "$DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS"
  append_env_entry DJANGO_SECURE_HSTS_PRELOAD "$DJANGO_SECURE_HSTS_PRELOAD"
  append_env_entry DJANGO_USE_X_FORWARDED_HOST "$DJANGO_USE_X_FORWARDED_HOST"
fi
chmod 640 "$ENV_FILE"
chown root:"$APP_GROUP" "$ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [[ "$DB_ENGINE" == "mysql" ]]; then
  [[ -n "$DB_PASSWORD" ]] || fail "${ENV_FILE} 中 DB_PASSWORD 不能为空。"
  [[ "$DB_PASSWORD" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]] || \
    fail "${ENV_FILE} 中 DB_PASSWORD 包含不支持的字符。"
fi

sql_literal() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

if [[ "$DB_ENGINE" == "mysql" && "$SKIP_MARIADB" != "1" ]]; then
  log "启动并初始化 MariaDB"
  systemctl enable --now mariadb
  mariadb_root_args=(--protocol=socket -uroot)
  if [[ -n "$MARIADB_ROOT_PASSWORD" ]]; then
    mariadb_root_args+=("--password=$MARIADB_ROOT_PASSWORD")
  fi
  db_password_sql="$(sql_literal "$DB_PASSWORD")"
  mariadb "${mariadb_root_args[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY $db_password_sql;
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY $db_password_sql;
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY $db_password_sql;
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY $db_password_sql;
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
elif [[ "$DB_ENGINE" == "mysql" ]]; then
  log "跳过本机 MariaDB，使用外部数据库 $DB_HOST:$DB_PORT"
fi

if [[ "$DB_ENGINE" == "mysql" ]]; then
  command -v mariadb-dump >/dev/null 2>&1 || fail "未找到 mariadb-dump。"
  install -d -m 700 "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/itam-$(date +%Y%m%d-%H%M%S).sql"
  if MYSQL_PWD="$DB_PASSWORD" mariadb-dump \
    --protocol=tcp -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    --single-transaction --routines --events "$DB_NAME" > "$BACKUP_FILE" && [[ -s "$BACKUP_FILE" ]]; then
    chmod 600 "$BACKUP_FILE"
    log "迁移前数据库备份：$BACKUP_FILE"
  else
    rm -f "$BACKUP_FILE"
    fail "数据库备份失败，已停止迁移。请检查数据库连接和权限。"
  fi
fi

log "创建 Python 虚拟环境并安装后端依赖"
if [[ -x "$APP_DIR/backend/.venv/bin/python" ]] && \
  ! "$APP_DIR/backend/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  rm -rf "$APP_DIR/backend/.venv"
fi
"$PYTHON_BIN" -m venv "$APP_DIR/backend/.venv"
"$APP_DIR/backend/.venv/bin/python" -m pip install --upgrade pip wheel
"$APP_DIR/backend/.venv/bin/python" -m pip install -r "$APP_DIR/backend/requirements.txt"
"$APP_DIR/backend/.venv/bin/python" -c 'import django; print("Django", django.get_version())'

log "执行 Django 迁移和检查"
cd "$APP_DIR/backend"
count_data() {
  "$APP_DIR/backend/.venv/bin/python" manage.py shell -c 'from django.db import connection; from assets.models import Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog; models=[Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog]; tables=set(connection.introspection.table_names()); missing_label="未迁移"; print("数据量："+" ".join(f"{model.__name__}={model.objects.count() if model._meta.db_table in tables else missing_label}" for model in models))'
}
log "迁移前数据量核对"
count_data
if ! "$APP_DIR/backend/.venv/bin/python" manage.py migrate --noinput; then
  fail "Django 迁移失败。备份文件：${BACKUP_FILE:-未生成（SQLite 或跳过数据库备份）}。请先恢复备份后再重试。"
fi
log "迁移后数据量核对"
count_data
"$APP_DIR/backend/.venv/bin/python" manage.py check_preset_roles
if [[ "$DJANGO_ENV" == "production" ]]; then
  deploy_check_output="$("$APP_DIR/backend/.venv/bin/python" manage.py check --deploy 2>&1)" || {
    printf '%s\n' "$deploy_check_output" >&2
    fail "Django check --deploy 执行失败。"
  }
  printf '%s\n' "$deploy_check_output"
  unexpected_security_warnings="$(printf '%s\n' "$deploy_check_output" | grep -E 'security\.W' | grep -vE 'security\.(W005|W021)' || true)"
  if [[ -n "$unexpected_security_warnings" ]]; then
    printf '%s\n' "$unexpected_security_warnings" >&2
    fail "Django check --deploy 仍包含未豁免的安全告警，生产部署已阻断。"
  fi
  if printf '%s\n' "$deploy_check_output" | grep -qE 'security\.(W005|W021)'; then
    log "保留 HSTS 子域/preload 告警：当前策略未默认覆盖所有子域，需由部署方确认后再启用。"
  fi
else
  log "开发环境跳过 Django check --deploy 生产安全门禁。"
fi
"$APP_DIR/backend/.venv/bin/python" manage.py check
"$APP_DIR/backend/.venv/bin/python" manage.py collectstatic --noinput --clear

log "安装并构建前端"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build

frontend_dist="$APP_DIR/frontend/dist"
[[ -s "$frontend_dist/index.html" ]] || fail "前端构建未生成：$frontend_dist/index.html"
# npm 会继承当前 umask；安装脚本此前为环境文件设置的 027 可能让
# dist 目录变成 750、静态文件变成 640，导致 Nginx 用户无法读取首页。
# 发布目录只提供静态资源，因此统一为目录 755、文件 644。
chmod 755 "$APP_DIR" "$APP_DIR/frontend"
find "$frontend_dist" -type d -exec chmod 755 {} +
find "$frontend_dist" -type f -exec chmod 644 {} +
chown -R "$APP_USER":"$APP_GROUP" "$APP_DIR"
chmod 640 "$ENV_FILE"
chown root:"$APP_GROUP" "$ENV_FILE"

log "写入 systemd 服务"
cat > /etc/systemd/system/itam.service <<EOF
[Unit]
Description=Infrix Django API
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=-$ENV_FILE
ExecStart=$APP_DIR/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8001 --workers $GUNICORN_WORKERS --timeout 120
Restart=always
RestartSec=5
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
chmod 644 /etc/systemd/system/itam.service

log "写入 Nginx 配置"
install -d -m 700 "$BACKUP_DIR"
install -d -m 755 "$(dirname -- "$NGINX_CONF_FILE")"

# Rocky 9 默认的 default.conf 通常也声明 server_name _，会导致新配置被忽略，
# 最终访问到 Nginx 默认站点并返回 400。先备份并移出 *.conf 匹配范围，便于恢复。
nginx_default_conf="/etc/nginx/conf.d/default.conf"
if [[ -f "$nginx_default_conf" ]] &&
  grep -Eq '^[[:space:]]*server_name[[:space:]]+_;' "$nginx_default_conf"; then
  nginx_default_backup="$BACKUP_DIR/nginx-default-$(date +%Y%m%d-%H%M%S).conf"
  cp -a "$nginx_default_conf" "$nginx_default_backup"
  mv "$nginx_default_conf" "${nginx_default_conf}.itam-disabled"
  log "已备份并停用冲突的 Nginx 默认配置：$nginx_default_backup"
fi

nginx_hsts_value="max-age=$DJANGO_SECURE_HSTS_SECONDS"
if [[ "$DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS" == "1" ]]; then
  nginx_hsts_value+="; includeSubDomains"
fi
if [[ "$DJANGO_SECURE_HSTS_PRELOAD" == "1" ]]; then
  nginx_hsts_value+="; preload"
fi

cat > "$NGINX_CONF_FILE" <<EOF
server {
    listen 80 default_server;
    server_name $SERVER_NAME;
    client_max_body_size 50m;
    root $APP_DIR/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        # This HTTP hop is private. The external TLS gateway must overwrite
        # X-Forwarded-Proto with exactly http or https before reaching it.
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }

    location /static/ {
        alias $APP_DIR/backend/staticfiles/;
        add_header Strict-Transport-Security "$nginx_hsts_value" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    location / {
        # SPA 路由可能与 Vite 的静态目录同名（例如 /assets），只服务
        # 真实文件，目录路径统一回退到 index.html，避免刷新时返回 403。
        try_files \$uri /index.html;
        add_header Strict-Transport-Security "$nginx_hsts_value" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
EOF
chmod 644 "$NGINX_CONF_FILE"
nginx -t

runuser -u nginx -- test -r "$frontend_dist/index.html" \
  || fail "Nginx 用户无法读取前端首页：$frontend_dist/index.html"

log "启动服务"
systemctl daemon-reload
systemctl enable itam
systemctl enable --now nginx
service_ready=0
for _ in $(seq 1 5); do
  systemctl restart itam || true
  sleep 2
  if systemctl is-active --quiet itam; then
    service_ready=1
    break
  fi
done
if [[ "$service_ready" -ne 1 ]]; then
  systemctl status itam --no-pager >&2 || true
  journalctl -u itam -n 100 --no-pager >&2 || true
  fail "Infrix 服务启动失败。"
fi
systemctl reload nginx

health_url="http://127.0.0.1:8001/api/v1/auth/csrf/"
api_ready=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet itam &&
    curl --retry 2 --retry-delay 1 -fsS --connect-timeout 2 --max-time 5 \
      -H "X-Forwarded-Proto: https" "$health_url" >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 1
done
if [[ "$api_ready" -ne 1 ]]; then
  systemctl status itam --no-pager >&2 || true
  journalctl -u itam -n 80 --no-pager >&2 || true
  fail "Infrix API 健康检查失败。"
fi

health_host="${DJANGO_ALLOWED_HOSTS%%,*}"
if [[ "$health_host" == "*" ]]; then
  health_host="$SERVER_NAME"
fi

if ! curl --retry 5 --retry-delay 1 -fsS --connect-timeout 5 --max-time 10 \
  -H "Host: $health_host" \
  -H "X-Forwarded-Proto: https" http://127.0.0.1/api/v1/auth/csrf/ >/dev/null 2>&1; then
  nginx -t >&2 || true
  systemctl status nginx --no-pager >&2 || true
  journalctl -u nginx -n 50 --no-pager >&2 || true
  fail "Nginx 反向代理健康检查失败。"
fi

if ! curl --retry 5 --retry-delay 1 -fsS --connect-timeout 5 --max-time 10 \
  -H "Host: $health_host" \
  -H "X-Forwarded-Proto: https" http://127.0.0.1/ >/dev/null 2>&1; then
  nginx -t >&2 || true
  systemctl status nginx --no-pager >&2 || true
  journalctl -u nginx -n 50 --no-pager >&2 || true
  fail "Nginx 前端静态资源健康检查失败。"
fi

if ! curl --retry 5 --retry-delay 1 -fsS --connect-timeout 5 --max-time 10 \
  -H "Host: $health_host" \
  -H "X-Forwarded-Proto: https" http://127.0.0.1/assets >/dev/null 2>&1; then
  nginx -t >&2 || true
  systemctl status nginx --no-pager >&2 || true
  journalctl -u nginx -n 50 --no-pager >&2 || true
  fail "Nginx 前端路由刷新检查失败：/assets"
fi

echo
if [[ "$DJANGO_ENV" == "production" ]]; then
  echo "Infrix 部署完成：请通过外部 HTTPS 网关访问。"
  echo "内部 Nginx：TCP 80（仅允许可信 HTTPS 网关访问）"
else
  echo "Infrix 开发环境部署完成：Nginx 监听 TCP 80。"
fi
echo "环境文件：$ENV_FILE"
echo "创建管理员：cd $APP_DIR/backend && sudo -u $APP_USER ./run.sh createsuperuser"
echo "注意：本脚本不会配置 SELinux 或防火墙，请按现有系统策略维护。"
