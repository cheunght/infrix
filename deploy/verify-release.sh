#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/infrix}"
APP_USER="${APP_USER:-infrix}"
ENV_FILE="${ENV_FILE:-/etc/infrix/infrix.env}"
BASE_URL="${BASE_URL:-}"
SYSTEMD_UNIT_FILE="${SYSTEMD_UNIT_FILE:-/etc/systemd/system/infrix.service}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-/etc/nginx/conf.d/infrix.conf}"

fail() {
  echo "验收失败：$*" >&2
  systemctl status infrix --no-pager >&2 2>/dev/null || true
  journalctl -u infrix -n 60 --no-pager >&2 2>/dev/null || true
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

[[ "$(id -u)" -eq 0 ]] || fail "请使用 root 执行，以便读取服务状态和应用环境。"
[[ -x "$APP_DIR/backend/run.sh" ]] || fail "未找到应用入口：$APP_DIR/backend/run.sh"
[[ -f "$ENV_FILE" ]] || fail "未找到环境文件：$ENV_FILE"

run_app() {
  runuser -u "$APP_USER" -- "$APP_DIR/backend/run.sh" "$@"
}

env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

production_security_gate() {
  local env_value_value debug_value secret_value hosts_value csrf_origins_value
  local https_mode ssl_redirect session_secure csrf_secure hsts_seconds forwarded_host base_url_lower
  env_value_value="$(env_value DJANGO_ENV)"
  debug_value="$(env_value DJANGO_DEBUG)"
  secret_value="$(env_value DJANGO_SECRET_KEY)"
  hosts_value="$(env_value DJANGO_ALLOWED_HOSTS)"
  csrf_origins_value="$(env_value DJANGO_CSRF_TRUSTED_ORIGINS)"
  https_mode="$(env_value DJANGO_HTTPS_MODE)"
  ssl_redirect="$(env_value DJANGO_SECURE_SSL_REDIRECT)"
  session_secure="$(env_value DJANGO_SESSION_COOKIE_SECURE)"
  csrf_secure="$(env_value DJANGO_CSRF_COOKIE_SECURE)"
  hsts_seconds="$(env_value DJANGO_SECURE_HSTS_SECONDS)"
  forwarded_host="$(env_value DJANGO_USE_X_FORWARDED_HOST)"

  log "检查生产安全配置（阻断式门禁）"
  [[ "$env_value_value" == "production" ]] || fail "DJANGO_ENV 必须为 production。"
  [[ "$debug_value" == "0" ]] || fail "DJANGO_DEBUG 必须为 0。"
  [[ -n "$secret_value" && "$secret_value" != "dev-only-change-me" && "$secret_value" != "change-me" && ${#secret_value} -ge 50 ]] || \
    fail "DJANGO_SECRET_KEY 缺失、过短或仍是占位符。"
  [[ -n "${hosts_value//[[:space:]]/}" ]] || fail "DJANGO_ALLOWED_HOSTS 不能为空。"
  if [[ "$hosts_value" =~ (^|,)[[:space:]]*\*[[:space:]]*(,|$) ]]; then
    fail "DJANGO_ALLOWED_HOSTS 不允许包含 *。"
  fi
  [[ -n "${csrf_origins_value//[[:space:]]/}" ]] || \
    fail "DJANGO_CSRF_TRUSTED_ORIGINS 不能为空。"
  case "$csrf_origins_value" in
    https://*) ;;
    *) fail "DJANGO_CSRF_TRUSTED_ORIGINS 必须使用 https://。" ;;
  esac
  [[ "$https_mode" == "proxy" ]] || fail "当前 Nginx 部署要求 DJANGO_HTTPS_MODE=proxy。"
  [[ "$ssl_redirect" == "1" ]] || fail "DJANGO_SECURE_SSL_REDIRECT 必须为 1。"
  [[ "$session_secure" == "1" ]] || fail "DJANGO_SESSION_COOKIE_SECURE 必须为 1。"
  [[ "$csrf_secure" == "1" ]] || fail "DJANGO_CSRF_COOKIE_SECURE 必须为 1。"
  [[ "$hsts_seconds" =~ ^[1-9][0-9]*$ ]] || fail "DJANGO_SECURE_HSTS_SECONDS 必须为正整数。"
  [[ "$forwarded_host" == "0" ]] || fail "DJANGO_USE_X_FORWARDED_HOST 必须为 0。"
  base_url_lower="$(printf '%s' "$BASE_URL" | tr '[:upper:]' '[:lower:]')"
  case "$base_url_lower" in
    https://*) ;;
    *) fail "BASE_URL 必须显式使用 https://，以验证正式入口。" ;;
  esac
  [[ -f "$APP_DIR/scripts/check-production-config.py" ]] || \
    fail "缺少生产配置校验脚本：$APP_DIR/scripts/check-production-config.py"
  runuser -u "$APP_USER" -- "$APP_DIR/backend/.venv/bin/python" \
    "$APP_DIR/scripts/check-production-config.py" \
    --env-file "$ENV_FILE" --require-proxy || fail "生产配置 preflight 未通过。"
  [[ -f "$NGINX_CONF_FILE" ]] || fail "未找到 Nginx 配置：$NGINX_CONF_FILE"
  grep -Fq 'proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;' "$NGINX_CONF_FILE" || \
    fail "Nginx 未保留受信任外部网关的 X-Forwarded-Proto 转发契约。"
  log "生产安全配置门禁通过（密钥值不会输出）。"
}

development_security_gate() {
  local env_value_value hosts_value
  env_value_value="$(env_value DJANGO_ENV)"
  hosts_value="$(env_value DJANGO_ALLOWED_HOSTS)"

  log "检查开发环境配置"
  [[ "$env_value_value" == "development" ]] || fail "DJANGO_ENV 必须为 development。"
  [[ -n "${hosts_value//[[:space:]]/}" ]] || \
    fail "开发环境 DJANGO_ALLOWED_HOSTS 不能为空；可设置为 *。"
  log "开发环境配置门禁通过（允许 DJANGO_ALLOWED_HOSTS=*）。"
}

deployment_env="$(env_value DJANGO_ENV)"
case "$deployment_env" in
  production)
    production_security_gate
    ;;
  development)
    development_security_gate
    BASE_URL="${BASE_URL:-http://127.0.0.1}"
    ;;
  *)
    fail "DJANGO_ENV 必须是 development 或 production。"
    ;;
esac
base_url_lower="$(printf '%s' "$BASE_URL" | tr '[:upper:]' '[:lower:]')"
case "$base_url_lower" in
  http://*|https://*) ;;
  *) fail "BASE_URL 必须使用 http:// 或 https://。" ;;
esac

log "检查 systemd 服务"
[[ -f "$SYSTEMD_UNIT_FILE" ]] || fail "未找到 systemd 服务定义：$SYSTEMD_UNIT_FILE"
grep -Fxq "EnvironmentFile=$ENV_FILE" "$SYSTEMD_UNIT_FILE" || \
  fail "systemd 服务必须使用 required EnvironmentFile=$ENV_FILE。"
if grep -Eq '^EnvironmentFile=-' "$SYSTEMD_UNIT_FILE"; then
  fail "systemd 服务不允许将生产环境文件标记为 optional。"
fi
systemctl is-active --quiet infrix || fail "infrix.service 未运行。"
systemctl is-active --quiet nginx || fail "nginx 未运行。"

log "检查 Django 配置和迁移"
run_app check >/dev/null || fail "Django check 未通过。"
if [[ "$deployment_env" == "production" ]]; then
  deploy_check_output="$(run_app check --deploy 2>&1)" || {
    printf '%s\n' "$deploy_check_output" >&2
    fail "Django check --deploy 执行失败。"
  }
  printf '%s\n' "$deploy_check_output"
  unexpected_security_warnings="$(printf '%s\n' "$deploy_check_output" | grep -E 'security\.W' | grep -vE 'security\.(W005|W021)' || true)"
  if [[ -n "$unexpected_security_warnings" ]]; then
    printf '%s\n' "$unexpected_security_warnings" >&2
    fail "Django check --deploy 仍包含未豁免的安全告警，已阻断验收。"
  fi
  if printf '%s\n' "$deploy_check_output" | grep -qE 'security\.(W005|W021)'; then
    log "Django check --deploy 保留 W005/W021：HSTS 子域和 preload 未默认开启，需在确认所有子域 HTTPS 后再评估。"
  fi
else
  log "开发环境跳过 Django check --deploy 生产安全门禁。"
fi
run_app makemigrations --check --dry-run >/dev/null || fail "存在未生成的模型迁移。"
run_app check_preset_roles >/dev/null || fail "预设角色检查未通过。"

migration_plan="$(run_app showmigrations --plan)"
if printf '%s\n' "$migration_plan" | grep -qE '^[[:space:]]*\[ \]'; then
  printf '%s\n' "$migration_plan" | grep -E '^[[:space:]]*\[ \]' >&2
  fail "存在未应用的数据库迁移。"
fi

log "检查核心数据表和数据量"
run_app shell -c 'from django.db import connection; from assets.models import Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog; models=[Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog]; tables=set(connection.introspection.table_names()); missing=[model._meta.db_table for model in models if model._meta.db_table not in tables]; print("缺少数据表："+", ".join(missing)) if missing else None; print("数据量："+" ".join(f"{model.__name__}={model.objects.count()}" for model in models)) if not missing else None; raise SystemExit(1 if missing else 0)' || fail "核心数据表检查失败。"

log "检查机柜 U 位完整性"
run_app shell -c 'from collections import defaultdict; from assets.models import RackUnitAllocation; allocations=list(RackUnitAllocation.objects.select_related("rack").order_by("rack_id","start_u","end_u","id")); errors=[]; grouped=defaultdict(list); [errors.append(f"allocation={row.id}: U位范围 {row.start_u}-{row.end_u} 超出机柜 {row.rack.code}/{row.rack.total_u}容量") for row in allocations if row.start_u < 1 or row.start_u > row.end_u or row.end_u > row.rack.total_u]; [grouped[row.rack_id].append(row) for row in allocations]; [(errors.append(f"rack={rack_id}: U位 {current.start_u}-{current.end_u} 与 {previous.start_u}-{previous.end_u} 重叠"), None) for rack_id, rows in grouped.items() for previous, current in zip(rows, rows[1:]) if current.start_u <= previous.end_u]; print("U位完整性检查通过："+str(len(allocations))+" 条上架记录") if not errors else print("U位完整性异常："+"；".join(errors[:20])); raise SystemExit(1 if errors else 0)' || fail "发现机柜 U 位越界或重叠。"

log "检查应用静态资源"
[[ -s "$APP_DIR/frontend/dist/index.html" ]] || fail "缺少前端构建产物：frontend/dist/index.html"
[[ -s "$APP_DIR/frontend/dist/platform-icon.png" ]] || fail "缺少浏览器图标：frontend/dist/platform-icon.png"

log "检查 API 和 Nginx 反向代理"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/api/v1/auth/csrf/" >/dev/null || fail "API 健康检查失败：${BASE_URL%/}"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/" >/dev/null || fail "前端静态资源健康检查失败：${BASE_URL%/}"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/assets" >/dev/null || fail "前端路由刷新检查失败：${BASE_URL%/}/assets"

log "上线验收通过"
echo "应用目录：$APP_DIR"
echo "环境文件：$ENV_FILE"
echo "检查地址：${BASE_URL%/}"
echo "最近备份："
find /var/backups/infrix -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort -r | head -5 || true
