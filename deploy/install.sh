#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
upgrade_background_units=()

resume_background_after_setup_failure() {
  [[ "${upgrade_mutation_started:-0}" == 0 ]] || return 0
  local background_unit
  for background_unit in "${upgrade_background_units[@]:-}"; do
    [[ -n "$background_unit" ]] || continue
    systemctl start "$background_unit" >/dev/null 2>&1 || true
  done
}

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  echo "错误：$*" >&2
  if [[ "${upgrade_service_was_active:-0}" == 1 && "${upgrade_mutation_started:-0}" == 0 ]]; then
    systemctl start infrix >&2 2>/dev/null || true
  fi
  resume_background_after_setup_failure
  exit 1
}

on_error() {
  local line="$1"
  echo "安装失败（第 ${line} 行），请查看上面的错误信息。" >&2
  systemctl status infrix --no-pager >&2 2>/dev/null || true
  journalctl -u infrix -n 60 --no-pager >&2 2>/dev/null || true
  if [[ -n "${upgrade_backup_file:-}" && -s "${upgrade_backup_file:-}" ]]; then
    echo "升级前数据库备份仍保留：$upgrade_backup_file" >&2
  fi
  if [[ "${upgrade_service_was_active:-0}" -eq 1 && "${upgrade_mutation_started:-0}" -eq 0 ]]; then
    systemctl start infrix >&2 2>/dev/null || true
  fi
  resume_background_after_setup_failure
}
trap 'on_error "$LINENO"' ERR

check_rocky_linux_9() {
  local os_release_file="${1:-/etc/os-release}"
  local os_id version_id

  if [[ ! -r "$os_release_file" ]]; then
    echo "Automatic installation is officially supported on Rocky Linux 9 only." >&2
    echo "For other Linux distributions, use the Manual Deployment Guide." >&2
    return 1
  fi

  os_id="$(awk -F= '$1 == "ID" { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); gsub(/^"|"$/, "", $2); print $2; exit }' "$os_release_file")"
  version_id="$(awk -F= '$1 == "VERSION_ID" { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); gsub(/^"|"$/, "", $2); print $2; exit }' "$os_release_file")"

  if [[ "$os_id" != "rocky" || ! "$version_id" =~ ^9(\.[0-9]+|\.x)?$ ]]; then
    echo "Automatic installation is officially supported on Rocky Linux 9 only." >&2
    echo "For other Linux distributions, use the Manual Deployment Guide." >&2
    return 1
  fi
}

PREFLIGHT_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preflight) PREFLIGHT_ONLY=1; shift ;;
    --config)
      [[ $# -ge 2 && "$2" = /* ]] || fail '--config 需要环境文件绝对路径。'
      ENV_FILE="$2"; shift 2 ;;
    -h|--help)
      echo '用法：sudo bash deploy/install.sh [--config /etc/infrix/infrix.env] [--preflight]'
      echo '首次安装自动进入向导；已有安装读取持久化配置。'
      exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

if [[ "$PREFLIGHT_ONLY" -eq 0 ]]; then
  check_rocky_linux_9 || exit 1
  [[ "$(id -u)" -eq 0 ]] || fail "请使用 root 执行：sudo -E ./deploy/install.sh"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR="${SOURCE_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd -P)}"
env_file_was_explicit=0
if [[ -n "${ENV_FILE:-}" ]]; then
  env_file_was_explicit=1
fi
ENV_FILE="${ENV_FILE:-/etc/infrix/infrix.env}"
APP_DIR="${APP_DIR:-/opt/infrix}"
APP_USER="${APP_USER:-infrix}"
APP_GROUP="${APP_GROUP:-infrix}"
server_name_was_explicit=0
if [[ -n "${SERVER_NAME:-}" ]]; then
  server_name_was_explicit=1
fi
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-/etc/nginx/conf.d/infrix.conf}"
TLS_CERT_FILE="${TLS_CERT_FILE:-/etc/pki/tls/certs/infrix.crt}"
TLS_KEY_FILE="${TLS_KEY_FILE:-/etc/pki/tls/private/infrix.key}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/infrix}"
INFRIX_BACKUP_DIR="${INFRIX_BACKUP_DIR:-/var/lib/infrix/backups}"
INFRIX_MAINTENANCE_DIR="${INFRIX_MAINTENANCE_DIR:-/var/lib/infrix/maintenance}"
SYSTEMD_UNIT_FILE="${SYSTEMD_UNIT_FILE:-/etc/systemd/system/infrix.service}"
DIGEST_SERVICE_UNIT_FILE="${DIGEST_SERVICE_UNIT_FILE:-/etc/systemd/system/infrix-notification-digest.service}"
DIGEST_TIMER_UNIT_FILE="${DIGEST_TIMER_UNIT_FILE:-/etc/systemd/system/infrix-notification-digest.timer}"
INSTALL_MODE="${INSTALL_MODE:-auto}"
SKIP_MARIADB="${SKIP_MARIADB:-0}"
PYTHON_BIN="${PYTHON_BIN:-}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-3}"

case "$INSTALL_MODE" in
  auto|fresh|upgrade) ;;
  *) fail "INSTALL_MODE 只能是 auto、fresh 或 upgrade。" ;;
esac

[[ -f "$SOURCE_DIR/backend/manage.py" ]] || fail "SOURCE_DIR 不是项目根目录：$SOURCE_DIR"
[[ -f "$SOURCE_DIR/frontend/package.json" ]] || fail "未找到 frontend/package.json。"
[[ -f "$SOURCE_DIR/frontend/package-lock.json" ]] || fail "未找到 frontend/package-lock.json，无法执行 npm ci。"
[[ -f "$SOURCE_DIR/scripts/check-production-config.py" ]] || \
  fail "未找到 scripts/check-production-config.py，无法执行生产配置门禁。"

[[ "$APP_DIR" = /* ]] || fail "APP_DIR 必须是绝对路径。"
[[ "$BACKUP_DIR" = /* ]] || fail "BACKUP_DIR 必须是绝对路径。"
[[ "$INFRIX_BACKUP_DIR" = /* ]] || fail "INFRIX_BACKUP_DIR 必须是绝对路径。"
[[ "$ENV_FILE" = /* ]] || fail "ENV_FILE 必须是绝对路径。"
[[ "$NGINX_CONF_FILE" = /* ]] || fail "NGINX_CONF_FILE 必须是绝对路径。"
[[ "$TLS_CERT_FILE" = /* ]] || fail "TLS_CERT_FILE 必须是绝对路径。"
[[ "$TLS_KEY_FILE" = /* ]] || fail "TLS_KEY_FILE 必须是绝对路径。"
[[ "$SYSTEMD_UNIT_FILE" = /* ]] || fail "SYSTEMD_UNIT_FILE 必须是绝对路径。"
[[ "$DIGEST_SERVICE_UNIT_FILE" = /* ]] || fail "DIGEST_SERVICE_UNIT_FILE 必须是绝对路径。"
[[ "$DIGEST_TIMER_UNIT_FILE" = /* ]] || fail "DIGEST_TIMER_UNIT_FILE 必须是绝对路径。"

validate_backup_directory_scope() {
  local media_root
  media_root="${INFRIX_MEDIA_ROOT:-$APP_DIR/backend/media}"
  if [[ "$media_root" != /* ]]; then
    media_root="$APP_DIR/backend/$media_root"
  fi
  "$safety_python_bin" - "$APP_DIR" "$INFRIX_BACKUP_DIR" "$media_root" <<'PY' || \
    fail "INFRIX_BACKUP_DIR 不能与应用、静态文件或媒体目录重叠：$INFRIX_BACKUP_DIR"
import os
import sys

app, backup, media = map(os.path.realpath, sys.argv[1:])
protected = (app, media, os.path.realpath(os.path.join(app, 'backend/staticfiles')),
             os.path.realpath(os.path.join(app, 'frontend/dist')))
for root in protected:
    if os.path.commonpath((backup, root)) in (backup, root):
        raise SystemExit(1)
PY
}

configure_media_sync_filter() {
  local media_root media_relative media_python_bin
  media_python_bin="${safety_python_bin:-${PYTHON_BIN:-python3}}"
  media_exclude=()
  media_root="${INFRIX_MEDIA_ROOT:-$APP_DIR/backend/media}"
  # Django resolves a relative MEDIA_ROOT from the backend working directory.
  # Keep the path lexical: rsync must protect an in-tree symlink itself too.
  media_relative="$("$media_python_bin" - "$APP_DIR" "$media_root" <<'PY'
import os
import sys

app = os.path.abspath(os.path.expanduser(sys.argv[1]))
media = os.path.expanduser(sys.argv[2])
if not os.path.isabs(media):
    media = os.path.join(app, 'backend', media)
media = os.path.normpath(media)

def inside(path, root):
    try:
        return os.path.commonpath((path, root)) == root
    except ValueError:
        return False

real_app = os.path.realpath(app)
real_media = os.path.realpath(media)
if not inside(media, app):
    # An external-looking alias may still point into the deletion boundary.
    print('!unsafe-alias' if inside(real_media, real_app) else '')
else:
    relative = os.path.relpath(media, app)
    parent = app
    for part in relative.split(os.sep)[:-1]:
        parent = os.path.join(parent, part)
        if os.path.islink(parent):
            print('!unsafe-alias')
            break
    else:
        # A final symlink to external media is safe when the link is excluded;
        # a link back into the app would leave its real target unprotected.
        print('!unsafe-alias' if os.path.islink(media) and inside(real_media, real_app) else relative)
PY
)"
  if [[ "$media_relative" == '!unsafe-alias' ]]; then
    fail 'MEDIA_ROOT 经符号链接指向应用同步边界内，无法安全排除。'
  fi
  if [[ "$media_relative" == . ]]; then
    fail "MEDIA_ROOT 不能等于应用目录：$APP_DIR"
  fi
  if [[ -n "$media_relative" ]]; then
    if [[ "$media_relative" == *'*'* || "$media_relative" == *'?'* ||
      "$media_relative" == *'['* || "$media_relative" == *']'* ||
      "$media_relative" == *$'\\'* || "$media_relative" == *$'\n'* ||
      "$media_relative" == *$'\r'* ]]; then
      fail 'MEDIA_ROOT 包含不支持的 rsync 过滤字符。'
    fi
    case "$media_relative" in
      backend/.venv|backend/.venv/*|backend/staticfiles|backend/staticfiles/*|frontend/dist|frontend/dist/*)
        fail 'MEDIA_ROOT 位于安装器会重建的目录内。' ;;
    esac
    if [[ "$SOURCE_DIR" != "$APP_DIR" && -e "$SOURCE_DIR/$media_relative" ]]; then
      fail "MEDIA_ROOT 与发布包内容重叠：$media_relative"
    fi
    # No trailing slash: exclude the path whether it is a directory or a
    # symlink to external media, while leaving sibling source paths syncable.
    media_exclude=(--exclude="/$media_relative")
    log "保护应用目录内的 MEDIA_ROOT：$media_relative"
  fi
}

sync_application_source() {
  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.venv/' \
    --exclude 'backend/.venv/' \
    --exclude 'backend/db.sqlite3*' \
    --exclude '/var/' \
    --exclude 'backend/staticfiles/' \
    --exclude 'frontend/node_modules/' \
    --exclude 'frontend/dist/' \
    --exclude '*.pyc' \
    --exclude '__pycache__/' \
    --exclude '.pytest_cache/' \
    "${media_exclude[@]}" \
    "$SOURCE_DIR/" "$APP_DIR/"
}

discover_environment_file_from_unit() {
  # A previous deployment may have used a custom environment-file path.  When
  # the caller did not explicitly select a path, preserve that path instead of
  # silently creating a second configuration for the same service.
  [[ "$env_file_was_explicit" -eq 0 && ! -f "$ENV_FILE" && -f "$SYSTEMD_UNIT_FILE" ]] || return 0

  local declared_path
  while IFS= read -r declared_path; do
    declared_path="${declared_path#-}"
    [[ "$declared_path" = /* && -f "$declared_path" ]] || continue
    ENV_FILE="$declared_path"
    log "从现有 systemd 服务恢复环境文件路径：$ENV_FILE"
    return 0
  done < <(sed -n -E 's/^[[:space:]]*EnvironmentFile[[:space:]]*=[[:space:]]*//p' "$SYSTEMD_UNIT_FILE")
}

discover_environment_file_from_unit

env_file_present=0
environment_reader="$SOURCE_DIR/backend/infrix_env.py"
safety_python_bin="${PYTHON_BIN:-python3}"
command -v "$safety_python_bin" >/dev/null 2>&1 || fail "未找到 Python 解释器：$safety_python_bin"

load_environment() {
  local entry loaded=0
  while IFS= read -r -d '' entry; do
    if [[ -z "$entry" ]]; then
      loaded=1
      break
    fi
    printf -v "${entry%%=*}" '%s' "${entry#*=}"
  done < <("$safety_python_bin" -I "$environment_reader" "$ENV_FILE")
  [[ "$loaded" == 1 ]] || fail "无法加载环境配置：$ENV_FILE"
}

if [[ "$PREFLIGHT_ONLY" == 0 ]]; then
  "$safety_python_bin" -I - "$ENV_FILE" "$SOURCE_DIR" "$APP_DIR" "$BACKUP_DIR" \
    "$NGINX_CONF_FILE" "$SYSTEMD_UNIT_FILE" "$DIGEST_SERVICE_UNIT_FILE" "$DIGEST_TIMER_UNIT_FILE" <<'PYROOT' || \
    fail "配置路径必须由 root 控制，旧安装请从单独的源码目录执行升级。"
import os
from pathlib import Path
import stat
import sys

env_file, source, app, *outputs = map(Path, sys.argv[1:])
paths = {part for path in (env_file, *outputs) for part in (path, *path.parents)}
if source.resolve() == app.resolve():
    paths.update(app / part for part in (
        "", "deploy", "backend", "scripts", "deploy/install.sh", "deploy/preflight.sh",
        "deploy/configure.sh", "scripts/check-production-config.py",
        "scripts/release-package.py", "backend/infrix_env.py",
    ))
if os.geteuid() == 0:
    for path in paths:
        try:
            status = path.lstat()
        except FileNotFoundError:
            continue
        if status.st_uid != 0 or status.st_mode & 0o022 or stat.S_ISLNK(status.st_mode):
            raise SystemExit(1)
if app == Path("/") or app.is_symlink() or env_file.resolve().is_relative_to(app.resolve()):
    raise SystemExit(1)
PYROOT
fi
if [[ -f "$ENV_FILE" ]]; then
  env_file_present=1
  load_environment
fi

# Preserve the site name from a previous Infrix Nginx configuration when the
# deployment caller did not provide SERVER_NAME.  This keeps remote upgrades
# from silently falling back to the catch-all server name "_".
if [[ "$server_name_was_explicit" -eq 0 && "$SERVER_NAME" == "_" && -f "$NGINX_CONF_FILE" ]]; then
  existing_server_name="$(sed -n -E \
    '/^[[:space:]]*server_name[[:space:]]+/ { s/^[[:space:]]*server_name[[:space:]]+([^;[:space:]]+).*/\1/; p; q; }' \
    "$NGINX_CONF_FILE")"
  if [[ -n "$existing_server_name" && "$existing_server_name" != "_" ]]; then
    SERVER_NAME="$existing_server_name"
    log "从现有 Nginx 配置恢复 SERVER_NAME=$SERVER_NAME"
  fi
fi

existing_installation=0
resume_phase=""
install_state_file="${ENV_FILE}.install-state"
if [[ -f "$install_state_file" && -f "$ENV_FILE" ]]; then
  read -r saved_phase saved_fingerprint < "$install_state_file"
  if [[ "$saved_phase" == configured || "$saved_phase" == database-ready ]]; then
    current_fingerprint="$( { sha256sum "$ENV_FILE"; printf '%s\n' "$APP_DIR"; } | sha256sum | cut -d ' ' -f1)"
    [[ "$current_fingerprint" == "$saved_fingerprint" ]] || fail '未完成安装的配置已变化，请恢复原配置后续装，避免使用错误数据库。'
    resume_phase="$saved_phase"
    log "继续未完成安装：$resume_phase"
  fi
fi
# A source-only staging directory is intentionally not an installation marker:
# deploy-to-remote.sh populates the target tree before this script runs.
if [[ -f "$SYSTEMD_UNIT_FILE" ||
  -x "$APP_DIR/backend/.venv/bin/python" ||
  -f "$APP_DIR/backend/db.sqlite3" ||
  -f "$APP_DIR/var/db.sqlite3" ]]; then
  existing_installation=1
fi
if [[ -n "$resume_phase" ]]; then
  existing_installation=0
fi
if [[ "$existing_installation" -eq 1 && "$env_file_present" -eq 0 ]]; then
  fail "Production environment file not found: ${ENV_FILE}; existing Infrix runtime detected, so no new configuration or migration was created. 请恢复该文件，或使用 ENV_FILE=/absolute/path/to/infrix.env 指向现有环境文件后重试。若目标只有同步的源码目录、没有服务/虚拟环境/数据库，可直接按全新安装重试。"
fi

case "$INSTALL_MODE" in
  auto)
    if [[ "$existing_installation" -eq 1 ]]; then
      INSTALL_MODE=upgrade
    else
      INSTALL_MODE=fresh
    fi
    ;;
  fresh)
    [[ "$existing_installation" -eq 0 ]] || \
      fail "检测到已有 Infrix 安装；如需升级请使用 INSTALL_MODE=upgrade（默认 auto 会自动选择升级），或使用空的应用目录和数据库执行全新安装。"
    ;;
  upgrade)
    [[ "$existing_installation" -eq 1 ]] || \
      fail "INSTALL_MODE=upgrade 要求目标目录已有 Infrix 安装；首次安装请使用 INSTALL_MODE=fresh 或 auto。"
    ;;
  *)
    fail "INSTALL_MODE 只能是 auto、fresh 或 upgrade。"
    ;;
esac

if [[ "$INSTALL_MODE" == "upgrade" ]]; then
  log "检测到已有 Infrix 基准安装，将执行原地升级；环境文件和业务数据库不会被覆盖。"
else
  log "未检测到已有 Infrix 安装，将执行全新安装。"
fi
if [[ "$PREFLIGHT_ONLY" -eq 1 && "$env_file_present" -eq 0 ]]; then
  fail "Production environment file not found: $ENV_FILE"
fi

DJANGO_ENV="${DJANGO_ENV:-}"
if [[ "$INSTALL_MODE" == "fresh" && -z "$DJANGO_ENV" && "$PREFLIGHT_ONLY" == 0 ]]; then
  . "$SCRIPT_DIR/configure.sh"
  configure_fresh_install
fi
case "$DJANGO_ENV" in
  production|development) ;;
  "") fail "DJANGO_ENV 必须显式设置为 production 或 development。" ;;
  *) fail "DJANGO_ENV 必须是 development 或 production。" ;;
esac

DB_ENGINE="${DB_ENGINE:-}"
DB_ENGINE="$(printf '%s' "$DB_ENGINE" | tr '[:upper:]' '[:lower:]')"
if [[ "$DJANGO_ENV" == "production" ]]; then
  DB_NAME="${DB_NAME:-}"
  DB_USER="${DB_USER:-}"
  DB_HOST="${DB_HOST:-}"
else
  DB_ENGINE="${DB_ENGINE:-sqlite}"
  DB_NAME="${DB_NAME:-infrix}"
  DB_USER="${DB_USER:-infrix}"
  DB_HOST="${DB_HOST:-127.0.0.1}"
fi
DB_PASSWORD="${DB_PASSWORD:-}"
DB_PORT="${DB_PORT:-3306}"
INFRIX_CONFIG_ENCRYPTION_KEY="${INFRIX_CONFIG_ENCRYPTION_KEY:-}"
if [[ "$INSTALL_MODE" == fresh && -z "$INFRIX_CONFIG_ENCRYPTION_KEY" ]]; then
  INFRIX_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"
fi
DJANGO_DEBUG="${DJANGO_DEBUG:-0}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-}"
DJANGO_ALLOWED_HOSTS="${DJANGO_ALLOWED_HOSTS:-}"
if [[ "$DJANGO_ENV" == "development" && -z "${DJANGO_ALLOWED_HOSTS//[[:space:]]/}" ]]; then
  if [[ "$SERVER_NAME" != "_" ]]; then
    DJANGO_ALLOWED_HOSTS="$SERVER_NAME,127.0.0.1,localhost"
  else
    DJANGO_ALLOWED_HOSTS="127.0.0.1,localhost"
  fi
fi
DJANGO_CSRF_TRUSTED_ORIGINS="${DJANGO_CSRF_TRUSTED_ORIGINS:-}"
DJANGO_HTTPS_MODE="${DJANGO_HTTPS_MODE:-proxy}"
DJANGO_SECURE_SSL_REDIRECT="${DJANGO_SECURE_SSL_REDIRECT:-1}"
DJANGO_SESSION_COOKIE_SECURE="${DJANGO_SESSION_COOKIE_SECURE:-1}"
DJANGO_CSRF_COOKIE_SECURE="${DJANGO_CSRF_COOKIE_SECURE:-1}"
DJANGO_SECURE_HSTS_SECONDS="${DJANGO_SECURE_HSTS_SECONDS:-3600}"
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS="${DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS:-0}"
DJANGO_SECURE_HSTS_PRELOAD="${DJANGO_SECURE_HSTS_PRELOAD:-0}"
DJANGO_USE_X_FORWARDED_HOST="${DJANGO_USE_X_FORWARDED_HOST:-0}"
DJANGO_TRUSTED_PROXY_IPS="${DJANGO_TRUSTED_PROXY_IPS:-127.0.0.1,::1}"
TZ="${TZ:-Asia/Shanghai}"
MARIADB_ROOT_PASSWORD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
export -n MARIADB_ROOT_PASSWORD MYSQL_ROOT_PASSWORD DB_PASSWORD DJANGO_SECRET_KEY INFRIX_CONFIG_ENCRYPTION_KEY

[[ "$GUNICORN_WORKERS" =~ ^[1-9][0-9]*$ ]] || fail "GUNICORN_WORKERS 必须是正整数。"
[[ "$SERVER_NAME" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || fail "SERVER_NAME 必须是主机名、IPv4 地址或 _。"

if [[ "$DJANGO_ENV" == "production" ]]; then
  [[ "$DB_ENGINE" == "mysql" ]] || fail "生产部署必须设置 DB_ENGINE=mysql；SQLite 仅用于开发和测试。"
  [[ -n "${DB_NAME//[[:space:]]/}" ]] || fail "生产部署必须设置 DB_NAME。"
  [[ -n "${DB_USER//[[:space:]]/}" ]] || fail "生产部署必须设置 DB_USER。"
  [[ -n "${DB_PASSWORD//[[:space:]]/}" ]] || fail "生产部署必须设置 DB_PASSWORD。"
  [[ -n "${DB_HOST//[[:space:]]/}" ]] || fail "生产部署必须设置 DB_HOST。"
else
  case "$DB_ENGINE" in
    mysql|sqlite) ;;
    *) fail "DB_ENGINE 只能是 mysql 或 sqlite。" ;;
  esac
fi
if [[ "$DB_ENGINE" == "mysql" ]]; then
  [[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_NAME 只能包含字母、数字和下划线。"
  [[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_USER 只能包含字母、数字和下划线。"
  [[ "$DB_HOST" =~ ^[A-Za-z0-9_:][A-Za-z0-9_.:-]*$ ]] || fail "DB_HOST 必须是主机名或 IP 地址。"
fi
[[ "$DB_PORT" =~ ^[0-9]+$ ]] || fail "DB_PORT 必须是数字。"
[[ "$DB_PORT" -ge 1 && "$DB_PORT" -le 65535 ]] || fail "DB_PORT 必须在 1 到 65535 之间。"
if [[ "$DB_ENGINE" == "sqlite" ]]; then
  SKIP_MARIADB=1
fi

if [[ "$existing_installation" -eq 1 && "$DJANGO_ENV" == "production" &&
  -z "${DJANGO_SECRET_KEY//[[:space:]]/}" ]]; then
  fail "已有生产安装缺少 DJANGO_SECRET_KEY；已停止，不能自动生成新密钥。"
fi

[[ "$INFRIX_BACKUP_DIR" = /* ]] || fail "INFRIX_BACKUP_DIR 必须是绝对路径：$INFRIX_BACKUP_DIR"
validate_backup_directory_scope
[[ "$INFRIX_MAINTENANCE_DIR" = /* ]] || fail "INFRIX_MAINTENANCE_DIR 必须是绝对路径。"
"$safety_python_bin" - "$INFRIX_MAINTENANCE_DIR" "$APP_DIR" "$INFRIX_BACKUP_DIR" "${INFRIX_MEDIA_ROOT:-$APP_DIR/backend/media}" <<'PY' || fail "维护目录必须独立于应用、备份和媒体目录。"
import os, sys
maintenance, *protected = map(os.path.realpath, sys.argv[1:])
for root in protected:
    if os.path.commonpath((maintenance, root)) in (maintenance, root):
        raise SystemExit(1)
PY
configure_media_sync_filter

runtime_dir="$APP_DIR/var"
[[ ! -L "$runtime_dir" ]] || fail "运行数据目录不能是符号链接：$runtime_dir"
media_source="$("$safety_python_bin" -I -c 'from pathlib import Path; import sys; print((Path(sys.argv[1]) / Path(sys.argv[2]).expanduser()).resolve())' \
  "$APP_DIR/backend" "${INFRIX_MEDIA_ROOT:-media}")"
media_target="$media_source"
app_real="$("$safety_python_bin" -I -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$APP_DIR")"
case "$media_source" in
  "$app_real/var"/*) ;;
  "$app_real"/*) media_target="$runtime_dir/media" ;;
esac
media_parent="$(dirname -- "$media_target")"
sqlite_source="${INFRIX_SQLITE_PATH:-$APP_DIR/backend/db.sqlite3}"
sqlite_target="$runtime_dir/db.sqlite3"
[[ ! -L "$media_target" && ! -L "$sqlite_target" ]] || fail "运行数据目标不能是符号链接。"

# These are emitted as literal tokens in systemd and Nginx files.
for directive_path in "$APP_DIR" "$ENV_FILE" "$INFRIX_BACKUP_DIR" "$INFRIX_MAINTENANCE_DIR" \
  "$media_target" "$TLS_CERT_FILE" "$TLS_KEY_FILE"; do
  [[ "$directive_path" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "部署配置路径包含不支持的字符。"
done
"$safety_python_bin" -I - "$media_parent" "$APP_DIR" "$runtime_dir" "$ENV_FILE" \
  "$BACKUP_DIR" "$INFRIX_BACKUP_DIR" "$INFRIX_MAINTENANCE_DIR" <<'PYDATA' || \
  fail "媒体父目录须独立于应用代码、配置、备份和维护目录。"
from pathlib import Path
import sys

parent, app, runtime, env_file, *protected = (Path(path).resolve() for path in sys.argv[1:])
if not parent.is_relative_to(runtime):
    protected += [app, env_file.parent]
    if any(parent.is_relative_to(path) or path.is_relative_to(parent) for path in protected):
        raise SystemExit(1)
PYDATA

if [[ "$PREFLIGHT_ONLY" -eq 1 ]]; then
  [[ -f "$ENV_FILE" ]] || fail "Production environment file not found: $ENV_FILE"
  PYTHON_BIN="${PYTHON_BIN:-python3}"
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || fail "未找到 Python 解释器：$PYTHON_BIN"
  "$PYTHON_BIN" -I "$SOURCE_DIR/scripts/check-production-config.py" \
    --env-file "$ENV_FILE" --require-proxy
  log "生产配置 preflight 通过；未修改系统或数据库。"
  exit 0
fi

. "$SCRIPT_DIR/preflight.sh"
check_machine_readiness

log "安装 Rocky 9 系统依赖"
system_packages=(ca-certificates openssl curl git rsync nginx mariadb-server mariadb
  gcc gcc-c++ make iproute policycoreutils)
dnf install -y "${system_packages[@]}"

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
"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "Python 版本必须 >= 3.11，当前为 $($PYTHON_BIN --version 2>&1)。"

prebuilt_frontend=0
if [[ -f "$SOURCE_DIR/frontend-release.json" ]]; then
  "$PYTHON_BIN" "$SOURCE_DIR/scripts/release-package.py" --verify-frontend "$SOURCE_DIR"
  prebuilt_frontend=1
fi
if [[ "$prebuilt_frontend" == 0 ]]; then
node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(env -u NODE_OPTIONS node --version | sed 's/^v//' | cut -d. -f1)"
fi
if [[ "$node_major" -ne 20 && "$node_major" -ne 22 && "$node_major" -lt 24 ]] || ! command -v npm >/dev/null 2>&1; then
  dnf module reset -y nodejs || true
  if ! dnf module enable -y nodejs:22; then
    dnf module enable -y nodejs:20 || true
  fi
  dnf install -y nodejs npm
fi
node_major="$(env -u NODE_OPTIONS node --version | sed 's/^v//' | cut -d. -f1)"
[[ "$node_major" -eq 20 || "$node_major" -eq 22 || "$node_major" -ge 24 ]] || fail "Node.js 版本必须为 20、22 或 >= 24，当前为 $(env -u NODE_OPTIONS node --version)。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm。"

# 受限内存的 Rocky VM 可能让 Node.js 自动将 V8 堆上限压到约 512 MB，
# 前端的 vue-tsc/vite 构建会因此触发 JavaScript heap out of memory。
# 默认使用 1 GB；部署方可以通过环境文件或调用环境中的 NODE_OPTIONS 覆盖。
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
log "Node.js $(env -u NODE_OPTIONS node --version)，前端构建使用 NODE_OPTIONS=$NODE_OPTIONS"
fi

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  log "准备应用目录 $APP_DIR"
else
  log "SOURCE_DIR 与 APP_DIR 相同，跳过复制。"
fi
getent group "$APP_GROUP" >/dev/null 2>&1 || groupadd --system "$APP_GROUP"
[[ "$(getent group "$APP_GROUP" | cut -d: -f3)" != 0 ]] || fail "APP_GROUP 必须是非 root 用户组。"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" \
    --no-create-home --shell /sbin/nologin "$APP_USER"
fi
if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  install -d -m 755 -o root -g "$APP_GROUP" "$APP_DIR"
fi
[[ "$(id -u "$APP_USER")" != 0 ]] || fail "APP_USER 必须是非 root 账号。"
build_user=infrix-build
[[ "$APP_USER" != "$build_user" ]] || fail "APP_USER 不能使用保留的构建用户 infrix-build。"
if ! id "$build_user" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --shell /sbin/nologin "$build_user"
fi
[[ "$(id -u "$build_user")" != 0 ]] || fail "构建用户必须是非 root 账号。"
env_directory="$(dirname -- "$ENV_FILE")"
if [[ ! -d "$env_directory" ]]; then
  install -d -m 750 -o root -g "$APP_GROUP" "$env_directory"
elif [[ "$env_directory" == /etc/infrix ]]; then
  chown root:"$APP_GROUP" "$env_directory"
  chmod 750 "$env_directory"
fi

if [[ -z "$DB_PASSWORD" && "$DB_ENGINE" == "mysql" && "$DJANGO_ENV" == "development" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
fi
if [[ "$DB_ENGINE" == "mysql" && ! "$DB_PASSWORD" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]]; then
  fail "DB_PASSWORD 只能包含字母、数字和 . _ @ % + = : , / -，请重新设置。"
fi

mariadb_local_config_changed=0
configure_local_mariadb_listener() {
  local config_file="/etc/my.cnf.d/90-infrix-local.cnf"
  install -d -m 755 /etc/my.cnf.d
  if [[ -e "$config_file" ]]; then
    grep -Eq '^[[:space:]]*bind-address[[:space:]]*=[[:space:]]*127\.0\.0\.1[[:space:]]*$' "$config_file" || \
      fail "检测到已有 ${config_file}，但未明确限制 MariaDB 仅监听 127.0.0.1；为避免扩大暴露面，安装已停止。"
  else
    cat > "$config_file" <<'EOF'
# Managed by Infrix: the local application database must not be publicly exposed.
[mysqld]
bind-address=127.0.0.1
EOF
    chmod 644 "$config_file"
    mariadb_local_config_changed=1
  fi
}

verify_local_mariadb_listener() {
  command -v ss >/dev/null 2>&1 || fail "未找到 ss，无法验证 MariaDB 是否仅监听本机地址。"
  local non_loopback_listener
  non_loopback_listener="$(ss -ltnH | awk '$4 ~ /:3306$/ && $4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/ { print $4; exit }')"
  [[ -z "$non_loopback_listener" ]] || \
    fail "本机 MariaDB 必须只监听 loopback 地址，但检测到非本机监听：${non_loopback_listener}。"
}

sql_literal() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

stop_existing_service_for_upgrade() {
  [[ ( "$INSTALL_MODE" == "upgrade" || "$resume_phase" == database-ready ) && -f "$SYSTEMD_UNIT_FILE" ]] || return 0
  if systemctl cat infrix-worker.service >/dev/null 2>&1; then
    systemctl disable --now infrix-worker.service || fail "无法停用旧任务服务，升级已停止。"
  fi
  local background_unit
  for background_unit in "$(basename -- "$DIGEST_TIMER_UNIT_FILE")" "$(basename -- "$DIGEST_SERVICE_UNIT_FILE")"; do
    if systemctl cat "$background_unit" >/dev/null 2>&1; then
      if systemctl is-active --quiet "$background_unit"; then
        upgrade_background_units+=("$background_unit")
      fi
      systemctl stop "$background_unit" || fail "无法停止 ${background_unit}，升级已停止。"
    fi
  done
  if systemctl is-active --quiet infrix; then
    upgrade_service_was_active=1
    log "停止 Infrix 服务，避免升级期间继续使用旧代码。"
    systemctl stop infrix || fail "无法停止现有 Infrix 服务，升级已停止。"
  fi
}

restart_service_after_upgrade_setup_failure() {
  if [[ "${upgrade_service_was_active:-0}" -eq 1 && "${upgrade_mutation_started:-0}" -eq 0 ]]; then
    systemctl start infrix >/dev/null 2>&1 || true
  fi
  resume_background_after_setup_failure
}

# Keep database secrets out of client arguments and subprocess environments.
database_client() (
  local password="$1" binary="$2" option_file
  shift 2
  unset DB_PASSWORD MYSQL_PWD MYSQL_ROOT_PASSWORD MARIADB_ROOT_PASSWORD
  [[ "$password" != *$'\n'* && "$password" != *$'\r'* ]] || return 1
  umask 077
  option_file="$(mktemp /var/tmp/infrix-mariadb.XXXXXXXX)"
  trap 'rm -f -- "$option_file"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  password="${password//\\/\\\\}"
  password="${password//\"/\\\"}"
  printf '[client]\npassword="%s"\n' "$password" > "$option_file"
  "$binary" --defaults-extra-file="$option_file" "$@"
)

validate_existing_migrations() {
  [[ "$INSTALL_MODE" == "upgrade" ]] || return 0

  local applied_migrations=""
  local sqlite_database
  local migration_name
  local migration_file
  local has_baseline_migration=0

  if [[ "$DB_ENGINE" == "mysql" ]]; then
    command -v mariadb >/dev/null 2>&1 || fail "未找到 mariadb 客户端，无法读取已有数据库的迁移记录。"
    if ! applied_migrations="$(
      database_client "$DB_PASSWORD" mariadb \
        --protocol=tcp -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
        --batch --skip-column-names "$DB_NAME" \
        -e "SELECT name FROM django_migrations WHERE app = 'assets' ORDER BY applied, name;"
    )"; then
      fail "无法读取已有数据库的 Infrix 迁移记录；请确认数据库连接和权限，升级已停止。"
    fi
  else
    sqlite_database="$sqlite_source"
    [[ -f "$sqlite_database" ]] || fail "升级要求已有 SQLite 数据库：$sqlite_database"
    if ! applied_migrations="$("$PYTHON_BIN" - "$sqlite_database" <<'PY'
import sqlite3
import sys

try:
    with sqlite3.connect(sys.argv[1]) as connection:
        rows = connection.execute(
            "SELECT name FROM django_migrations WHERE app = ? ORDER BY applied, name",
            ("assets",),
        )
        for (name,) in rows:
            print(name)
except sqlite3.Error as error:
    print(error, file=sys.stderr)
    raise SystemExit(1)
PY
)"; then
      fail "无法读取已有 SQLite 数据库的 Infrix 迁移记录，升级已停止。"
    fi
  fi

  [[ -n "${applied_migrations//[[:space:]]/}" ]] || \
    fail "已有数据库没有 Infrix 迁移记录；当前版本只支持从 Infrix 基准版本原地升级。"

  while IFS= read -r migration_name; do
    [[ -n "$migration_name" ]] || continue
    [[ "$migration_name" =~ ^[A-Za-z0-9_]+$ ]] || \
      fail "已有数据库包含无法识别的迁移记录：${migration_name}，升级已停止。"
    migration_file="$SOURCE_DIR/backend/assets/migrations/${migration_name}.py"
    [[ -f "$migration_file" ]] || \
      fail "已有数据库已应用迁移 ${migration_name}，但当前安装包不包含该迁移；仅支持从 Infrix 基准版本升级。"
    if [[ "$migration_name" == "0001_initial" ]]; then
      has_baseline_migration=1
    fi
  done <<< "$applied_migrations"

  [[ "$has_baseline_migration" -eq 1 ]] || \
    fail "已有数据库未应用 Infrix 基准迁移 0001_initial，升级已停止。"
  log "已有数据库迁移记录与当前 Infrix 基准兼容。"
}

backup_existing_database() {
  [[ "$INSTALL_MODE" == "upgrade" || "$resume_phase" == database-ready ]] || return 0

  local timestamp
  local backup_file
  local temporary_file
  local dump_binary
  local sqlite_database

  install -d -m 700 "$BACKUP_DIR"
  timestamp="$(date +%Y%m%d-%H%M%S)-$$"

  if [[ "$DB_ENGINE" == "mysql" ]]; then
    if command -v mariadb-dump >/dev/null 2>&1; then
      dump_binary="mariadb-dump"
    elif command -v mysqldump >/dev/null 2>&1; then
      dump_binary="mysqldump"
    else
      restart_service_after_upgrade_setup_failure
      fail "未找到 mariadb-dump 或 mysqldump，无法在升级前创建数据库备份。"
    fi
    backup_file="$BACKUP_DIR/database-${timestamp}.sql"
    temporary_file="${backup_file}.tmp"
    if ! database_client "$DB_PASSWORD" "$dump_binary" \
      --protocol=tcp -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
      --single-transaction --quick --triggers --hex-blob "$DB_NAME" > "$temporary_file"; then
      rm -f -- "$temporary_file"
      restart_service_after_upgrade_setup_failure
      fail "升级前数据库备份失败，未修改应用代码或数据库。"
    fi
  else
    sqlite_database="$sqlite_source"
    if [[ ! -f "$sqlite_database" ]]; then
      restart_service_after_upgrade_setup_failure
      fail "升级要求已有 SQLite 数据库：$sqlite_database"
    fi
    backup_file="$BACKUP_DIR/database-${timestamp}.sqlite3"
    temporary_file="${backup_file}.tmp"
    if ! cp -a -- "$sqlite_database" "$temporary_file"; then
      rm -f -- "$temporary_file"
      restart_service_after_upgrade_setup_failure
      fail "升级前 SQLite 数据库备份失败，未修改应用代码或数据库。"
    fi
  fi

  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$backup_file"
  upgrade_backup_file="$backup_file"
  log "升级前数据库备份已创建：$backup_file"
}

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
    log "开发环境部署：使用 DJANGO_ALLOWED_HOSTS=${DJANGO_ALLOWED_HOSTS}，跳过生产安全门禁。"
    ;;
  *)
    fail "DJANGO_ENV 必须是 development 或 production。"
    ;;
esac

quote_environment_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}
if [[ ! -f "$ENV_FILE" ]]; then
  log "创建 $ENV_FILE"
  environment_temporary_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  (
    umask 027
    cat > "$environment_temporary_file" <<EOF
DJANGO_ENV=$DJANGO_ENV
DJANGO_DEBUG=$DJANGO_DEBUG
DJANGO_SECRET_KEY=$(quote_environment_value "$DJANGO_SECRET_KEY")
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
DJANGO_TRUSTED_PROXY_IPS=$DJANGO_TRUSTED_PROXY_IPS
TZ=$TZ
DB_ENGINE=$DB_ENGINE
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
INFRIX_CONFIG_ENCRYPTION_KEY=$INFRIX_CONFIG_ENCRYPTION_KEY
INFRIX_BACKUP_DIR=$INFRIX_BACKUP_DIR
INFRIX_MAINTENANCE_DIR=$INFRIX_MAINTENANCE_DIR
SERVER_NAME=$SERVER_NAME
TLS_MODE=${TLS_MODE:-auto}
TLS_CERT_FILE=$TLS_CERT_FILE
TLS_KEY_FILE=$TLS_KEY_FILE
SKIP_MARIADB=$SKIP_MARIADB
EOF
  )
  mv -- "$environment_temporary_file" "$ENV_FILE"
else
  log "使用现有环境文件 $ENV_FILE"
  if [[ "$INSTALL_MODE" == fresh ]]; then
    if ! grep -q '^DJANGO_SECRET_KEY=' "$ENV_FILE"; then
      printf '\nDJANGO_SECRET_KEY=%s\n' "$(quote_environment_value "$DJANGO_SECRET_KEY")" >> "$ENV_FILE"
    fi
    if ! grep -q '^INFRIX_CONFIG_ENCRYPTION_KEY=' "$ENV_FILE"; then
      printf '\nINFRIX_CONFIG_ENCRYPTION_KEY=%s\n' "$INFRIX_CONFIG_ENCRYPTION_KEY" >> "$ENV_FILE"
    fi
  fi
fi
if ! grep -q '^INFRIX_BACKUP_DIR=' "$ENV_FILE"; then
  printf '\nINFRIX_BACKUP_DIR=%s\n' "$INFRIX_BACKUP_DIR" >> "$ENV_FILE"
fi
if ! grep -q '^INFRIX_MAINTENANCE_DIR=' "$ENV_FILE"; then
  printf '\nINFRIX_MAINTENANCE_DIR=%s\n' "$INFRIX_MAINTENANCE_DIR" >> "$ENV_FILE"
fi
chmod 640 "$ENV_FILE"
chown root:"$APP_GROUP" "$ENV_FILE"

if [[ "$DB_ENGINE" == "mysql" ]]; then
  [[ -n "$DB_PASSWORD" ]] || fail "${ENV_FILE} 中 DB_PASSWORD 不能为空。"
  [[ "$DB_PASSWORD" =~ ^[A-Za-z0-9._@%+=:,/-]+$ ]] || \
    fail "${ENV_FILE} 中 DB_PASSWORD 包含不支持的字符。"
fi

"$PYTHON_BIN" -I "$SOURCE_DIR/scripts/check-production-config.py" \
  --env-file "$ENV_FILE" --require-proxy

save_install_phase() {
  local phase="$1" fingerprint temporary_state
  fingerprint="$( { sha256sum "$ENV_FILE"; printf '%s\n' "$APP_DIR"; } | sha256sum | cut -d ' ' -f1)"
  temporary_state="$(mktemp "${install_state_file}.XXXXXX")"
  chmod 600 "$temporary_state"
  printf '%s\t%s\n' "$phase" "$fingerprint" > "$temporary_state"
  mv -f -- "$temporary_state" "$install_state_file"
}
if [[ "$INSTALL_MODE" == fresh && -z "$resume_phase" ]]; then
  save_install_phase configured
fi


if [[ "$DB_ENGINE" == "mysql" && "$SKIP_MARIADB" != "1" ]]; then
  log "启动并初始化 MariaDB"
  configure_local_mariadb_listener
  systemctl enable --now mariadb
  if [[ "$mariadb_local_config_changed" -eq 1 ]]; then
    systemctl restart mariadb
  fi
  verify_local_mariadb_listener
  db_password_sql="$(sql_literal "$DB_PASSWORD")"
  database_client "$MARIADB_ROOT_PASSWORD" mariadb --protocol=socket -uroot <<SQL
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

if [[ "$INSTALL_MODE" == "upgrade" ]]; then
  validate_existing_migrations
fi

# Build in a separate directory while the current application is still running.
# Keep failed preparation directories for diagnosis; never replace live code here.
prepare_dir="$(mktemp -d /var/tmp/infrix-prepare.XXXXXXXX)"
chown "$build_user" "$prepare_dir"
chmod 700 "$prepare_dir"
run_build() {
  runuser -u "$build_user" -- env -u DB_PASSWORD -u MYSQL_PWD -u MARIADB_ROOT_PASSWORD \
    -u MYSQL_ROOT_PASSWORD -u DJANGO_SECRET_KEY -u INFRIX_CONFIG_ENCRYPTION_KEY \
    HOME="$prepare_dir" NODE_OPTIONS="${NODE_OPTIONS:-}" "$@"
}
if [[ "$media_parent" != "$runtime_dir" && "$media_parent" != "$runtime_dir/"* ]]; then
  runuser -u "$APP_USER" -- test -w "$media_parent" || \
    fail "附件恢复需要服务账号可写的媒体父目录：$media_parent"
fi
log "准备新版本依赖和静态资源：${prepare_dir}（此阶段不停止 Infrix）"
install -m 644 "$SOURCE_DIR/backend/requirements.txt" "$prepare_dir/requirements.txt"
install -m 644 "$SOURCE_DIR/backend/requirements.lock" "$prepare_dir/requirements.lock"
run_build "$PYTHON_BIN" -m venv "$prepare_dir/venv"
run_build "$prepare_dir/venv/bin/python" -m pip wheel \
  --wheel-dir "$prepare_dir/wheels" -r "$prepare_dir/requirements.txt"
mkdir "$prepare_dir/frontend"
if [[ "$prebuilt_frontend" == 1 ]]; then
  mkdir "$prepare_dir/frontend/dist"
  rsync -a "$SOURCE_DIR/frontend/dist/" "$prepare_dir/frontend/dist/"
else
  rsync -a --exclude=node_modules/ --exclude=dist/ "$SOURCE_DIR/frontend/" "$prepare_dir/frontend/"
  chown -hR "$build_user" "$prepare_dir/frontend"
  (
    cd "$prepare_dir/frontend"
    run_build npm ci --no-audit --no-fund
    run_build npm run build
  )
fi
[[ -s "$prepare_dir/frontend/dist/index.html" ]] || fail '前端准备失败，未停止现有服务。'

if [[ "$INSTALL_MODE" == "upgrade" || "$resume_phase" == database-ready ]]; then
  stop_existing_service_for_upgrade
  backup_existing_database
fi

if [[ "$DB_ENGINE" == "mysql" && "$INSTALL_MODE" == "fresh" && "$resume_phase" != database-ready ]]; then
  database_table_count="$(
    database_client "$DB_PASSWORD" mariadb \
      --protocol=tcp -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
      --batch --skip-column-names information_schema \
      -e "SELECT COUNT(*) FROM TABLES WHERE TABLE_SCHEMA = $(sql_literal "$DB_NAME");"
  )" || fail "无法连接数据库以确认全新安装状态，已停止。"
  [[ "$database_table_count" =~ ^[0-9]+$ ]] || \
    fail "无法确认数据库是否为空，已停止。"
  if [[ "$database_table_count" -gt 0 ]]; then
    fail "全新安装要求目标数据库为空；检测到已有数据库表，已停止。"
  fi
  log "数据库为空，确认是全新安装。"
fi
if [[ "$INSTALL_MODE" == fresh ]]; then
  save_install_phase database-ready
fi

if [[ "$INSTALL_MODE" == "upgrade" || "$resume_phase" == database-ready ]]; then
  upgrade_mutation_started=1
fi
if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  log "复制项目到 $APP_DIR"
  sync_application_source
fi
for code_dir in "$APP_DIR/backend" "$APP_DIR/frontend"; do
  [[ -d "$code_dir" && ! -L "$code_dir" ]] || fail "应用代码目录无效：$code_dir"
done

if [[ "$INSTALL_MODE" == "upgrade" ]]; then
  log "开始应用当前 Infrix 版本：同步源代码、执行迁移并重建静态资源。"
else
  log "已确认目标数据库为空，开始初始化全新 Infrix 安装。"
fi

install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$runtime_dir"
if [[ "$media_parent" == "$runtime_dir" || "$media_parent" == "$runtime_dir/"* ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$media_parent"
fi
install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$media_target"
if [[ "$media_source" != "$media_target" && -d "$media_source" ]]; then
  log "复制旧媒体文件到独立运行目录：$media_target"
  rsync -a "$media_source/" "$media_target/"
fi
chown -hR "$APP_USER":"$APP_GROUP" "$media_target"
runuser -u "$APP_USER" -- test -w "$media_parent" || \
  fail "附件恢复需要服务账号可写的媒体父目录：$media_parent"

if [[ "$DB_ENGINE" == sqlite && "$sqlite_source" != "$sqlite_target" && -r "$sqlite_source" ]]; then
  # Copy through SQLite so a pre-existing journal is included.
  "$safety_python_bin" -I - "$sqlite_source" "$sqlite_target" <<'PYSQLITE'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as source, sqlite3.connect(sys.argv[2]) as target:
    source.backup(target)
PYSQLITE
  chown "$APP_USER":"$APP_GROUP" "$sqlite_target"
  chmod 600 "$sqlite_target"
fi

persist_runtime_path() {
  local key="$1" value="$2" previous="${!1:-}"
  [[ "$previous" == "$value" ]] || printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}
persist_runtime_path INFRIX_MEDIA_ROOT "$media_target"
if [[ "$DB_ENGINE" == sqlite ]]; then
  persist_runtime_path INFRIX_SQLITE_PATH "$sqlite_target"
fi
if [[ "$INSTALL_MODE" == fresh ]]; then
  save_install_phase database-ready
fi

log "创建 Python 虚拟环境并安装后端依赖"
# Never execute or reuse an older service-writable interpreter.
rm -rf -- "$APP_DIR/backend/.venv"
install -d -m 755 -o "$build_user" "$APP_DIR/backend/.venv"
run_build "$PYTHON_BIN" -m venv "$APP_DIR/backend/.venv"
run_build "$APP_DIR/backend/.venv/bin/python" -m pip install --no-index \
  --find-links "$prepare_dir/wheels" -r "$prepare_dir/requirements.txt"

log "安装已验证的前端构建产物"
rm -rf -- "$APP_DIR/frontend/dist"
mkdir -p "$APP_DIR/frontend/dist"
rsync -a --delete "$prepare_dir/frontend/dist/" "$APP_DIR/frontend/dist/"

frontend_dist="$APP_DIR/frontend/dist"
[[ -s "$frontend_dist/index.html" ]] || fail "前端构建未生成：$frontend_dist/index.html"

# Only the separate runtime subtree stays writable by the service.
find "$APP_DIR" -path "$runtime_dir" -prune -o -exec chown -h root:"$APP_GROUP" {} +
find "$APP_DIR" -path "$runtime_dir" -prune -o \
  \( -type f -o -type d \) -exec chmod go-w,u-s,g-s {} +
chmod 755 "$APP_DIR" "$APP_DIR/backend" "$APP_DIR/frontend"
install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$INFRIX_BACKUP_DIR"
install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$INFRIX_MAINTENANCE_DIR"
# collectstatic writes only here during installation. Freeze it again before starting Nginx.
rm -rf -- "$APP_DIR/backend/staticfiles"
install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR/backend/staticfiles"

run_backend() {
  local python="$APP_DIR/backend/.venv/bin/python"
  runuser -u "$APP_USER" -- env PYTHONDONTWRITEBYTECODE=1 \
    "$python" -I "$APP_DIR/backend/infrix_env.py" "$ENV_FILE" "$python" "$@"
}

log "执行 Django 迁移和检查"
cd "$APP_DIR/backend"
count_data() {
  run_backend manage.py shell -c 'from django.db import connection; from assets.models import Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog; models=[Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog]; tables=set(connection.introspection.table_names()); missing_label="未迁移"; print("数据量："+" ".join(f"{model.__name__}={model.objects.count() if model._meta.db_table in tables else missing_label}" for model in models))'
}
count_data_raw() {
  # This runs before Django migrations.  A table may already exist while the
  # current model still expects columns that have not been added yet (for
  # example assets_asset.archived_at).  Use a raw table count here so the
  # diagnostic cannot query a stale schema through the current ORM manager.
  run_backend - <<'PY'
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()

from django.db import connection
from assets.models import (
    Asset,
    AssetCustomValue,
    AssetTag,
    AuditLog,
    CustomField,
    DataCenter,
    FaultEvent,
    InventoryItem,
    InventoryTask,
    Rack,
    RackUnitAllocation,
    RepairRecord,
    ServerRoom,
    SoftwareLicense,
    SparePart,
    SpareStock,
    SpareStockTransaction,
    Tag,
)

models = [
    Asset, DataCenter, ServerRoom, Rack, RackUnitAllocation, FaultEvent,
    RepairRecord, SoftwareLicense, InventoryTask, InventoryItem, SparePart,
    SpareStock, SpareStockTransaction, CustomField, AssetCustomValue, Tag,
    AssetTag, AuditLog,
]
tables = set(connection.introspection.table_names())
counts = []
with connection.cursor() as cursor:
    for model in models:
        table = model._meta.db_table
        if table not in tables:
            value = "未迁移"
        else:
            cursor.execute("SELECT COUNT(*) FROM " + connection.ops.quote_name(table))
            value = cursor.fetchone()[0]
        counts.append(f"{model.__name__}={value}")
print("数据量（原始表计数）：" + " ".join(counts))
PY
}
log "迁移前数据量核对"
count_data_raw
if ! run_backend manage.py migrate --noinput; then
  fail "Django 数据库迁移失败，请检查数据库连接、权限和当前安装包。"
fi
log "迁移后数据量核对"
count_data
run_backend manage.py check_preset_roles
if [[ "$DJANGO_ENV" == "production" ]]; then
  deploy_check_output="$(run_backend manage.py check --deploy 2>&1)" || {
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
run_backend manage.py check
run_backend manage.py collectstatic --noinput --clear

chown -hR root:"$APP_GROUP" "$APP_DIR/backend/staticfiles"
find "$frontend_dist" "$APP_DIR/backend/staticfiles" -type d -exec chmod 755 {} +
find "$frontend_dist" "$APP_DIR/backend/staticfiles" -type f -exec chmod 644 {} +
rm -rf -- "$prepare_dir"

writable_paths="$runtime_dir $INFRIX_BACKUP_DIR $INFRIX_MAINTENANCE_DIR"
if [[ "$media_parent" != "$runtime_dir" && "$media_parent" != "$runtime_dir/"* ]]; then
  writable_paths+=" $media_parent"
fi

maintenance_drain="${INFRIX_MAINTENANCE_DRAIN_SECONDS:-60}"
[[ "$maintenance_drain" =~ ^[1-9][0-9]{0,5}$ ]] || fail "INFRIX_MAINTENANCE_DRAIN_SECONDS 必须是正整数。"
gunicorn_grace=$((maintenance_drain + 15))
systemd_stop_timeout=$((gunicorn_grace + 15))
log "写入 systemd 服务"
cat > "$SYSTEMD_UNIT_FILE" <<EOF
[Unit]
Description=Infrix Django API
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8001 --workers $GUNICORN_WORKERS --timeout 120 --graceful-timeout $gunicorn_grace
TimeoutStopSec=$systemd_stop_timeout
Restart=always
RestartSec=5
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$writable_paths
CapabilityBoundingSet=
UMask=0027
Environment=PYTHONDONTWRITEBYTECODE=1

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$SYSTEMD_UNIT_FILE"

log "写入每日邮件摘要定时任务"
cat > "$DIGEST_SERVICE_UNIT_FILE" <<EOF
[Unit]
Description=Infrix daily notification digest
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/backend/.venv/bin/python manage.py send_notification_digest
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$writable_paths
CapabilityBoundingSet=
UMask=0027
Environment=PYTHONDONTWRITEBYTECODE=1
EOF
chmod 644 "$DIGEST_SERVICE_UNIT_FILE"

cat > "$DIGEST_TIMER_UNIT_FILE" <<EOF
[Unit]
Description=Infrix daily notification digest schedule

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=15m
Unit=$(basename -- "$DIGEST_SERVICE_UNIT_FILE")

[Install]
WantedBy=timers.target
EOF
chmod 644 "$DIGEST_TIMER_UNIT_FILE"

log "写入 Nginx 配置"
install -d -m 700 "$BACKUP_DIR"
install -d -m 755 "$(dirname -- "$NGINX_CONF_FILE")"

# Rocky 9 默认的 default.conf 通常也声明 server_name _，会导致新配置被忽略，
# 最终访问到 Nginx 默认站点并返回 400。先备份并移出 *.conf 匹配范围，便于恢复。
nginx_backup_and_disable_conf() {
  local source_conf="$1"
  local timestamp
  local backup_conf
  local disabled_conf

  [[ -f "$source_conf" ]] || return 0
  [[ "$source_conf" == "$NGINX_CONF_FILE" ]] && return 0

  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_conf="$BACKUP_DIR/nginx-$(basename -- "$source_conf")-$timestamp.conf"
  disabled_conf="${source_conf}.infrix-disabled"
  if [[ -e "$disabled_conf" ]]; then
    disabled_conf="${source_conf}.infrix-disabled-$timestamp"
  fi
  cp -a "$source_conf" "$backup_conf"
  mv "$source_conf" "$disabled_conf"
  log "已备份并停用冲突的 Nginx 配置：$backup_conf"
}

nginx_default_conf="/etc/nginx/conf.d/default.conf"
if [[ -f "$nginx_default_conf" ]] &&
  grep -Eq '^[[:space:]]*listen[[:space:]]+(80|\[::\]:80)[^;]*default_server([[:space:];]|$)|^[[:space:]]*server_name[[:space:]]_;' "$nginx_default_conf"; then
  nginx_backup_and_disable_conf "$nginx_default_conf"
fi

# 现场可能还配置了其它 Nginx 站点。应用使用实际 SERVER_NAME 时可以通过
# server_name 精确匹配，因此不必再声明第二个 default_server。
nginx_listen_directive="listen 80 default_server"
while IFS= read -r -d '' nginx_candidate; do
  [[ "$nginx_candidate" == "$NGINX_CONF_FILE" ]] && continue
  if grep -Eq '^[[:space:]]*listen[[:space:]]+(80|\[::\]:80)[^;]*default_server([[:space:];]|$)' "$nginx_candidate"; then
    nginx_listen_directive="listen 80"
    log "检测到其它 Nginx 配置已占用 80 端口 default_server，Infrix 配置改用 server_name 精确匹配。"
    break
  fi
done < <(find /etc/nginx -type f -name '*.conf' -print0 2>/dev/null)

local_tls_enabled=0
if [[ "${TLS_MODE:-auto}" == self-signed && ! -e "$TLS_CERT_FILE" && ! -e "$TLS_KEY_FILE" ]]; then
  install -d -m 755 "$(dirname -- "$TLS_CERT_FILE")"
  install -d -m 700 "$(dirname -- "$TLS_KEY_FILE")"
  tls_san="DNS:$SERVER_NAME"
  if [[ "$SERVER_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    tls_san="IP:$SERVER_NAME"
  fi
  (umask 077; openssl req -x509 -newkey rsa:3072 -nodes -days 825 \
    -keyout "$TLS_KEY_FILE" -out "$TLS_CERT_FILE" \
    -subj "/CN=$SERVER_NAME" -addext "subjectAltName=$tls_san")
  chmod 644 "$TLS_CERT_FILE"
fi
if [[ -e "$TLS_CERT_FILE" || -e "$TLS_KEY_FILE" ]]; then
  [[ -f "$TLS_CERT_FILE" && -f "$TLS_KEY_FILE" ]] || \
    fail "检测到本机 TLS 配置不完整；TLS_CERT_FILE 和 TLS_KEY_FILE 必须同时存在。"
  local_tls_enabled=1
fi
if [[ "${TLS_MODE:-auto}" == gateway ]]; then
  local_tls_enabled=0
fi

nginx_tls_listen_directive="listen 443 ssl default_server"
if [[ "$local_tls_enabled" -eq 1 ]]; then
  while IFS= read -r -d '' nginx_candidate; do
    [[ "$nginx_candidate" == "$NGINX_CONF_FILE" ]] && continue
    if grep -Eq '^[[:space:]]*listen[[:space:]]+(443|\[::\]:443)[^;]*ssl[^;]*default_server([[:space:];]|$)' "$nginx_candidate"; then
      nginx_tls_listen_directive="listen 443 ssl"
      log "检测到其它 Nginx 配置已占用 443 端口 default_server，Infrix 配置改用 TLS server_name 精确匹配。"
      break
    fi
  done < <(find /etc/nginx -type f -name '*.conf' -print0 2>/dev/null)
fi

nginx_hsts_value="max-age=$DJANGO_SECURE_HSTS_SECONDS"
nginx_previous_config=""
if [[ -f "$NGINX_CONF_FILE" ]]; then
  install -d -m 700 "$BACKUP_DIR"
  nginx_previous_config="$BACKUP_DIR/infrix-nginx-$(date +%Y%m%d-%H%M%S)-$$.conf"
  cp -a -- "$NGINX_CONF_FILE" "$nginx_previous_config"
  log "现有站点配置已备份：$nginx_previous_config"
fi
if [[ "$DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS" == "1" ]]; then
  nginx_hsts_value+="; includeSubDomains"
fi
if [[ "$DJANGO_SECURE_HSTS_PRELOAD" == "1" ]]; then
  nginx_hsts_value+="; preload"
fi

if [[ "$local_tls_enabled" -eq 1 ]]; then
  redirect_host="$SERVER_NAME"
  if [[ "$redirect_host" == "_" ]]; then
    redirect_host="${DJANGO_ALLOWED_HOSTS%%,*}"
    redirect_host="${redirect_host//[[:space:]]/}"
  fi
  [[ "$redirect_host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail "本机 TLS 需要明确的 HTTPS 跳转主机名。"
  log "检测到本机 TLS 证书，生成 HTTPS Nginx 配置：$TLS_CERT_FILE"
  cat > "$NGINX_CONF_FILE" <<EOF
server {
    $nginx_listen_directive;
    server_name $SERVER_NAME;
    return 301 https://$redirect_host\$request_uri;
}

server {
    $nginx_tls_listen_directive;
    server_name $SERVER_NAME;
    ssl_certificate $TLS_CERT_FILE;
    ssl_certificate_key $TLS_KEY_FILE;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "$nginx_hsts_value" always;
    client_max_body_size 50m;
    root $APP_DIR/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_read_timeout 135s;
        proxy_hide_header Strict-Transport-Security;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_read_timeout 135s;
        proxy_hide_header Strict-Transport-Security;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
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
else
  cat > "$NGINX_CONF_FILE" <<EOF
server {
    $nginx_listen_directive;
    server_name $SERVER_NAME;
    client_max_body_size 50m;
    root $APP_DIR/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_read_timeout 135s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        # This HTTP hop is private. The external TLS gateway must overwrite
        # X-Forwarded-Proto with exactly http or https before reaching it.
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_read_timeout 135s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
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
fi
chmod 644 "$NGINX_CONF_FILE"
if [[ -n "$nginx_previous_config" ]]; then
  diff -u -- "$nginx_previous_config" "$NGINX_CONF_FILE" || true
fi
if ! nginx -t; then
  if [[ -n "$nginx_previous_config" ]]; then
    cp -a -- "$nginx_previous_config" "$NGINX_CONF_FILE"
    log "新配置验证失败，已恢复原 Nginx 站点配置。"
  else
    install -d -m 700 "$BACKUP_DIR"
    mv -- "$NGINX_CONF_FILE" "$BACKUP_DIR/infrix-nginx-rejected-$$.conf"
  fi
  fail "Nginx 配置未通过验证，未执行 reload。"
fi

runuser -u nginx -- test -r "$frontend_dist/index.html" \
  || fail "Nginx 用户无法读取前端首页：$frontend_dist/index.html"

configure_selinux_for_reverse_proxy() {
  if ! command -v getenforce >/dev/null 2>&1; then
    log "未检测到 SELinux 工具，跳过 SELinux 反向代理策略配置。"
    return 0
  fi

  local selinux_mode
  selinux_mode="$(getenforce)"
  case "$selinux_mode" in
    Enforcing|Permissive)
      command -v getsebool >/dev/null 2>&1 || \
        fail "SELinux 已启用但缺少 getsebool，无法验证 Nginx 反向代理策略。"
      command -v setsebool >/dev/null 2>&1 || \
        fail "SELinux 已启用但缺少 setsebool，无法配置 Nginx 反向代理策略。"
      if ! getsebool httpd_can_network_connect | grep -qE -- '(^|[[:space:]])on$'; then
        setsebool -P httpd_can_network_connect 1 || \
          fail "无法启用 SELinux httpd_can_network_connect 策略，安装已停止。"
      fi
      getsebool httpd_can_network_connect | grep -qE -- '(^|[[:space:]])on$' || \
        fail "SELinux httpd_can_network_connect 策略未生效，安装已停止。"
      log "SELinux ${selinux_mode}：已验证 Nginx 到 Gunicorn 的 httpd_can_network_connect 策略。"
      ;;
    Disabled)
      log "SELinux 已禁用；未修改 SELinux 状态。"
      ;;
    *)
      fail "无法识别 SELinux 状态：${selinux_mode}。"
      ;;
  esac
}

configure_selinux_for_reverse_proxy

log "启动服务"
rm -f /etc/systemd/system/infrix-worker.service
systemctl daemon-reload
systemctl enable infrix
systemctl enable --now nginx
service_ready=0
for _ in $(seq 1 5); do
  systemctl restart infrix || true
  sleep 2
  if systemctl is-active --quiet infrix; then
    service_ready=1
    break
  fi
done
if [[ "$service_ready" -ne 1 ]]; then
  systemctl status infrix --no-pager >&2 || true
  journalctl -u infrix -n 100 --no-pager >&2 || true
  fail "Infrix 服务启动失败。"
fi
systemctl reload nginx
systemctl enable --now "$(basename -- "$DIGEST_TIMER_UNIT_FILE")"

health_host="${DJANGO_ALLOWED_HOSTS%%,*}"
if [[ "$health_host" == "*" ]]; then
  health_host="$SERVER_NAME"
fi

health_url="http://127.0.0.1:8001/api/v1/auth/csrf/"
api_ready=0
for _ in $(seq 1 30); do
  if systemctl is-active --quiet infrix &&
    curl --retry 2 --retry-delay 1 -fsS --connect-timeout 2 --max-time 5 \
      -H "Host: $health_host" \
      -H "X-Forwarded-Proto: https" "$health_url" >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 1
done
if [[ "$api_ready" -ne 1 ]]; then
  systemctl status infrix --no-pager >&2 || true
  journalctl -u infrix -n 80 --no-pager >&2 || true
  fail "Infrix API 健康检查失败。"
fi

nginx_probe_url="http://127.0.0.1"
nginx_probe_args=(-H "Host: $health_host" -H "X-Forwarded-Proto: https")
if [[ "$local_tls_enabled" -eq 1 ]]; then
  nginx_probe_url="https://$redirect_host"
  nginx_probe_args=(--resolve "$redirect_host:443:127.0.0.1" --cacert "${TLS_CA_FILE:-$TLS_CERT_FILE}")
fi
for probe_path in /api/v1/auth/csrf/ / /assets; do
  probe_status="$(curl --retry 5 --retry-delay 1 -fsS --connect-timeout 5 --max-time 10 \
    "${nginx_probe_args[@]}" -o /dev/null -w '%{http_code}' "$nginx_probe_url$probe_path")" || probe_status=""
  if [[ "$probe_status" != 200 ]]; then
    nginx -t >&2 || true
    systemctl status nginx --no-pager >&2 || true
    journalctl -u nginx -n 50 --no-pager >&2 || true
    fail "Nginx 健康检查失败：$probe_path"
  fi
done

echo
log "验证实际 HTTPS 入口（含证书、首页和会话接口）"
site_url="https://${SERVER_NAME}"
if [[ "$SERVER_NAME" == "_" ]]; then
  site_url="https://${health_host}"
fi
doctor_ca="${TLS_CA_FILE:-}"
if [[ -z "$doctor_ca" && "$local_tls_enabled" == 1 ]]; then
  doctor_ca="$TLS_CERT_FILE"
fi
if [[ "$DJANGO_ENV" == "production" ]]; then
  bash "$APP_DIR/deploy/doctor.sh" "$site_url" "$doctor_ca" || \
    fail "应用已启动，但实际 HTTPS 入口未通过验收；请修复入口后重新执行 doctor。"
fi
if [[ "$DJANGO_ENV" == "production" ]]; then
  echo "Infrix 部署完成：$site_url"
  if [[ "$local_tls_enabled" == "1" ]]; then
    echo "本机 Nginx 提供 HTTPS，HTTP 自动跳转。"
  else
    echo "通过外部 HTTPS 网关访问，内部 Nginx 使用 TCP 80。"
  fi
else
  echo "Infrix 开发环境部署完成：Nginx 监听 TCP 80。"
fi
echo "环境文件：$ENV_FILE"
if [[ -t 0 ]]; then
  administrator_exists="$(runuser -u "$APP_USER" -- env INFRIX_ENV_FILE="$ENV_FILE" \
    "$APP_DIR/backend/run.sh" shell -c 'from django.contrib.auth import get_user_model; print(int(get_user_model().objects.filter(is_superuser=True,is_active=True).exists()))' | tail -n 1)"
  if [[ "$administrator_exists" == 0 ]]; then
    log '创建首个管理员（密码输入不会显示）'
    runuser -u "$APP_USER" -- env INFRIX_ENV_FILE="$ENV_FILE" "$APP_DIR/backend/run.sh" createsuperuser
  fi
fi
if [[ "$INSTALL_MODE" == fresh ]]; then
  save_install_phase complete
fi
echo "创建管理员：cd $APP_DIR/backend && sudo -u $APP_USER ./run.sh createsuperuser"
echo "注意：本脚本不会配置防火墙；请按生产网络策略维护入口、TLS 和 Security Group。"
